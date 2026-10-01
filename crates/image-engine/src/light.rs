/// Monotone, channel-wise SDR tone adjustments. Shadow/highlight curves anchor
/// black and white; the narrower endpoint controls can lift/crush those endpoints.
/// Values are normalized to [-1, 1]. These are not Adobe's local tone operators.
#[inline]
pub fn apply(mut value: f32, settings: &[f32; 4]) -> f32 {
    let [highlights, shadows, whites, blacks] = *settings;
    if shadows != 0.0 {
        let inverse = 1.0 - value;
        value = (value + shadows * value * inverse * inverse * inverse).clamp(0.0, 1.0);
    }
    if highlights != 0.0 {
        value = (value + highlights * value * value * value * (1.0 - value)).clamp(0.0, 1.0);
    }
    if blacks != 0.0 {
        let inverse = 1.0 - value;
        value = (value + 0.25 * blacks * inverse * inverse * inverse * inverse).clamp(0.0, 1.0);
    }
    if whites != 0.0 {
        value = (value + 0.25 * whites * value * value * value * value).clamp(0.0, 1.0);
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn controls_target_their_tonal_ranges_and_endpoints() {
        let low = 0.25;
        let high = 0.75;
        assert!(
            apply(low, &[0.0, 1.0, 0.0, 0.0]) - low > apply(high, &[0.0, 1.0, 0.0, 0.0]) - high
        );
        assert!(
            apply(high, &[-1.0, 0.0, 0.0, 0.0]) - high < apply(low, &[-1.0, 0.0, 0.0, 0.0]) - low
        );
        assert_eq!(apply(0.0, &[1.0, 1.0, 0.0, 0.0]), 0.0);
        assert_eq!(apply(1.0, &[-1.0, -1.0, 0.0, 0.0]), 1.0);
        assert_eq!(apply(0.0, &[0.0, 0.0, 0.0, 1.0]), 0.25);
        assert_eq!(apply(1.0, &[0.0, 0.0, -1.0, 0.0]), 0.75);
    }
    #[test]
    fn extreme_combinations_remain_monotone_and_bounded() {
        for highlights in [-1.0, 0.0, 1.0] {
            for shadows in [-1.0, 0.0, 1.0] {
                for whites in [-1.0, 0.0, 1.0] {
                    for blacks in [-1.0, 0.0, 1.0] {
                        let mut previous = 0.0;
                        for i in 0..=1024 {
                            let value =
                                apply(i as f32 / 1024.0, &[highlights, shadows, whites, blacks]);
                            assert!(value >= previous - 1e-6 && (0.0..=1.0).contains(&value));
                            previous = value;
                        }
                    }
                }
            }
        }
    }
}
