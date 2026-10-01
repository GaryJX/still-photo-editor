pub type Bands = [[f32; 3]; 8];
const CENTERS: [f32; 9] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0];

pub fn parse(values: &[f32]) -> Result<Bands, &'static str> {
    if values.len() != 24
        || values
            .iter()
            .any(|value| !value.is_finite() || value.abs() > 100.0)
    {
        return Err("Expected 24 color-mix values between -100 and 100");
    }
    Ok(std::array::from_fn(|band| {
        std::array::from_fn(|key| values[band * 3 + key])
    }))
}

fn to_hsl(rgb: [f32; 3]) -> [f32; 3] {
    let [r, g, b] = rgb;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let chroma = max - min;
    let lightness = (max + min) / 2.0;
    if chroma <= 0.000001 {
        return [0.0, 0.0, lightness];
    }
    let hue = if max == r {
        ((g - b) / chroma).rem_euclid(6.0)
    } else if max == g {
        (b - r) / chroma + 2.0
    } else {
        (r - g) / chroma + 4.0
    } * 60.0;
    [
        hue,
        chroma / (1.0 - (2.0 * lightness - 1.0).abs()),
        lightness,
    ]
}

fn from_hsl([h, s, l]: [f32; 3]) -> [f32; 3] {
    let chroma = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let sector = h.rem_euclid(360.0) / 60.0;
    let x = chroma * (1.0 - (sector.rem_euclid(2.0) - 1.0).abs());
    let rgb = match sector as usize {
        0 => [chroma, x, 0.0],
        1 => [x, chroma, 0.0],
        2 => [0.0, chroma, x],
        3 => [0.0, x, chroma],
        4 => [x, 0.0, chroma],
        _ => [chroma, 0.0, x],
    };
    rgb.map(|value| value + l - chroma / 2.0)
}

pub fn apply(rgb: [f32; 3], bands: &Bands) -> [f32; 3] {
    let [hue, saturation, lightness] = to_hsl(rgb);
    if saturation <= 0.000001 {
        return rgb;
    }
    let left = (0..8).find(|&i| hue < CENTERS[i + 1]).unwrap_or(7);
    let right = (left + 1) % 8;
    let t = (hue - CENTERS[left]) / (CENTERS[left + 1] - CENTERS[left]);
    let blended: [f32; 3] =
        std::array::from_fn(|key| bands[left][key] * (1.0 - t) + bands[right][key] * t);
    // Avoid shifting gray or nearly neutral pixels based on an unstable hue.
    let strength = (saturation * 4.0).min(1.0);
    from_hsl([
        hue + blended[0] * 0.3 * strength,
        (saturation * (1.0 + blended[1] / 100.0 * strength)).clamp(0.0, 1.0),
        (lightness + blended[2] / 200.0 * strength).clamp(0.0, 1.0),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bytes(rgb: [f32; 3]) -> [u8; 3] {
        rgb.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
    }
    #[test]
    fn targets_one_color_and_preserves_neutrals() {
        let mut bands = [[0.0; 3]; 8];
        bands[3][1] = -100.0;
        assert_eq!(bytes(apply([0.0, 1.0, 0.0], &bands)), [128, 128, 128]);
        assert_eq!(bytes(apply([1.0, 0.0, 0.0], &bands)), [255, 0, 0]);
        assert_eq!(apply([0.5; 3], &bands), [0.5; 3]);
    }
    #[test]
    fn shifts_hue_and_blends_across_red_wraparound() {
        let mut bands = [[0.0; 3]; 8];
        bands[0][0] = 100.0;
        assert_eq!(bytes(apply([1.0, 0.0, 0.0], &bands)), [255, 128, 0]);
        let before = apply(from_hsl([359.999, 1.0, 0.5]), &bands);
        let after = apply(from_hsl([0.001, 1.0, 0.5]), &bands);
        assert!(before.iter().zip(after).all(|(a, b)| (a - b).abs() < 0.001));
    }
    #[test]
    fn zero_values_round_trip_and_invalid_values_fail() {
        for rgb in [[0.2, 0.4, 0.7], [1.0, 0.1, 0.6], [0.0; 3], [1.0; 3]] {
            assert_eq!(bytes(apply(rgb, &[[0.0; 3]; 8])), bytes(rgb));
        }
        assert!(parse(&[0.0; 23]).is_err());
        assert!(parse(&[f32::NAN; 24]).is_err());
        assert!(parse(&[101.0; 24]).is_err());
    }
}
