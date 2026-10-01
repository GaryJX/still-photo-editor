pub struct Layout {
    source_width: usize,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    rotation: u32,
    region: Option<[usize; 6]>,
}

impl Layout {
    pub fn parse(values: &[u32], bytes: usize) -> Result<Self, &'static str> {
        if values.len() != 7 && values.len() != 13 {
            return Err("Invalid geometry layout");
        }
        let [sw, sh, x, y, width, height, rotation] = <[u32; 7]>::try_from(&values[..7]).unwrap();
        let (sw, sh, x, y, width, height) = (
            sw as usize,
            sh as usize,
            x as usize,
            y as usize,
            width as usize,
            height as usize,
        );
        if sw == 0
            || sh == 0
            || width == 0
            || height == 0
            || rotation > 3
            || sw.checked_mul(sh).and_then(|n| n.checked_mul(4)) != Some(bytes)
            || x.checked_add(width).is_none_or(|end| end > sw)
            || y.checked_add(height).is_none_or(|end| end > sh)
        {
            return Err("Crop is outside the source image");
        }
        let region = if values.len() == 13 {
            let r: [usize; 6] = std::array::from_fn(|i| values[7 + i] as usize);
            let [rx, ry, rw, rh, ow, oh] = r;
            let (width, height) = if rotation % 2 == 0 {
                (width, height)
            } else {
                (height, width)
            };
            if rw == 0
                || rh == 0
                || ow == 0
                || oh == 0
                || ow > 2048
                || oh > 2048
                || ow > rw
                || oh > rh
                || rx.checked_add(rw).is_none_or(|end| end > width)
                || ry.checked_add(rh).is_none_or(|end| end > height)
            {
                return Err("Invalid detail region");
            }
            Some(r)
        } else {
            None
        };
        Ok(Self {
            source_width: sw,
            x,
            y,
            width,
            height,
            rotation,
            region,
        })
    }
    // Sample only the visible output rectangle. At native size this is an exact
    // pixel copy; lower zoom uses bilinear, alpha-weighted source sampling.
    fn transform_region(&self, input: &[u8], r: [usize; 6]) -> Vec<u8> {
        let [rx, ry, rw, rh, ow, oh] = r;
        let mut result = vec![0; ow * oh * 4];
        let offset = |dx: usize, dy: usize| {
            let (x, y) = match self.rotation {
                1 => (dy, self.height - 1 - dx),
                2 => (self.width - 1 - dx, self.height - 1 - dy),
                3 => (self.width - 1 - dy, dx),
                _ => (dx, dy),
            };
            ((self.y + y) * self.source_width + self.x + x) * 4
        };
        for y in 0..oh {
            for x in 0..ow {
                let dx = rx as f64 + ((x as f64 + 0.5) * rw as f64 / ow as f64 - 0.5);
                let dy = ry as f64 + ((y as f64 + 0.5) * rh as f64 / oh as f64 - 0.5);
                let x0 = dx.floor() as usize;
                let y0 = dy.floor() as usize;
                let to = (y * ow + x) * 4;
                if rw == ow && rh == oh {
                    let from = offset(x0, y0);
                    result[to..to + 4].copy_from_slice(&input[from..from + 4]);
                    continue;
                }
                let x1 = (x0 + 1).min(rx + rw - 1);
                let y1 = (y0 + 1).min(ry + rh - 1);
                let fx = dx.fract();
                let fy = dy.fract();
                let mut rgba = [0.0; 4];
                for (sx, sy, weight) in [
                    (x0, y0, (1.0 - fx) * (1.0 - fy)),
                    (x1, y0, fx * (1.0 - fy)),
                    (x0, y1, (1.0 - fx) * fy),
                    (x1, y1, fx * fy),
                ] {
                    let from = offset(sx, sy);
                    let alpha_weight = input[from + 3] as f64 * weight;
                    rgba[3] += alpha_weight;
                    for c in 0..3 {
                        rgba[c] += input[from + c] as f64 * alpha_weight;
                    }
                }
                if rgba[3] > 0.0 {
                    for c in 0..3 {
                        result[to + c] = (rgba[c] / rgba[3]).round() as u8;
                    }
                }
                result[to + 3] = rgba[3].round() as u8;
            }
        }
        result
    }

    pub fn transform(&self, input: &[u8]) -> Vec<u8> {
        if let Some(region) = self.region {
            return self.transform_region(input, region);
        }
        let output_width = if self.rotation % 2 == 0 {
            self.width
        } else {
            self.height
        };
        let mut result = vec![0; self.width * self.height * 4];
        if self.rotation == 0 {
            for row in 0..self.height {
                let from = ((self.y + row) * self.source_width + self.x) * 4;
                let to = row * self.width * 4;
                result[to..to + self.width * 4]
                    .copy_from_slice(&input[from..from + self.width * 4]);
            }
            return result;
        }
        for y in 0..self.height {
            for x in 0..self.width {
                let (dx, dy) = match self.rotation {
                    1 => (self.height - 1 - y, x),
                    2 => (self.width - 1 - x, self.height - 1 - y),
                    3 => (y, self.width - 1 - x),
                    _ => (x, y),
                };
                let from = ((self.y + y) * self.source_width + self.x + x) * 4;
                let to = (dy * output_width + dx) * 4;
                result[to..to + 4].copy_from_slice(&input[from..from + 4]);
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_and_quarter_turns_preserve_pixels_and_alpha() {
        let source: Vec<u8> = (1..=6).flat_map(|n| [n, 0, 0, 100 + n]).collect();
        for (rotation, expected) in [
            (0, vec![2, 3, 5, 6]),
            (1, vec![5, 2, 6, 3]),
            (2, vec![6, 5, 3, 2]),
            (3, vec![3, 6, 2, 5]),
        ] {
            let result = Layout::parse(&[3, 2, 1, 0, 2, 2, rotation], source.len())
                .unwrap()
                .transform(&source);
            assert_eq!(
                result.chunks_exact(4).map(|p| p[0]).collect::<Vec<_>>(),
                expected
            );
            assert!(result.chunks_exact(4).all(|p| p[3] == 100 + p[0]));
        }
    }
    #[test]
    fn native_regions_match_full_cropped_output_at_every_rotation() {
        let source: Vec<u8> = (0..60).flat_map(|n| [n, 255 - n, 37, 100 + n]).collect();
        for rotation in 0..4 {
            let mut values = vec![10, 6, 1, 1, 8, 4, rotation];
            let full = Layout::parse(&values, source.len())
                .unwrap()
                .transform(&source);
            let width = if rotation % 2 == 0 { 8 } else { 4 };
            values.extend([1, 1, 2, 3, 2, 3]);
            let region = Layout::parse(&values, source.len())
                .unwrap()
                .transform(&source);
            for y in 0..3 {
                assert_eq!(
                    &region[y * 8..y * 8 + 8],
                    &full[((y + 1) * width + 1) * 4..((y + 1) * width + 3) * 4]
                );
            }
        }
    }
    #[test]
    fn detail_downsampling_weights_alpha_and_limits_allocations() {
        let source = [255, 0, 0, 0, 0, 100, 0, 255];
        let layout = Layout::parse(&[2, 1, 0, 0, 2, 1, 0, 0, 0, 2, 1, 1, 1], 8).unwrap();
        assert_eq!(layout.transform(&source), [0, 100, 0, 128]);
        assert!(Layout::parse(&[2, 1, 0, 0, 2, 1, 0, 1, 0, 2, 1, 2, 1], 8).is_err());
        assert!(
            Layout::parse(&[4096, 1, 0, 0, 4096, 1, 0, 0, 0, 4096, 1, 2049, 1], 16384).is_err()
        );
    }
    #[test]
    fn rejects_out_of_bounds_and_mismatched_dimensions() {
        assert!(Layout::parse(&[3, 2, 2, 0, 2, 2, 0], 24).is_err());
        assert!(Layout::parse(&[3, 2, 0, 0, 3, 2, 4], 24).is_err());
        assert!(Layout::parse(&[3, 2, 0, 0, 3, 2, 0], 20).is_err());
    }
}
