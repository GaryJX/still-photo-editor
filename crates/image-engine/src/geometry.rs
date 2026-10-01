pub struct Layout {
    source_width: usize,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    rotation: u32,
}

impl Layout {
    pub fn parse(values: &[u32], bytes: usize) -> Result<Self, &'static str> {
        if values.len() != 7 {
            return Err("Invalid geometry layout");
        }
        let [sw, sh, x, y, width, height, rotation] = <[u32; 7]>::try_from(values).unwrap();
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
        Ok(Self {
            source_width: sw,
            x,
            y,
            width,
            height,
            rotation,
        })
    }
    pub fn transform(&self, input: &[u8]) -> Vec<u8> {
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
    fn rejects_out_of_bounds_and_mismatched_dimensions() {
        assert!(Layout::parse(&[3, 2, 2, 0, 2, 2, 0], 24).is_err());
        assert!(Layout::parse(&[3, 2, 0, 0, 3, 2, 4], 24).is_err());
        assert!(Layout::parse(&[3, 2, 0, 0, 3, 2, 0], 20).is_err());
    }
}
