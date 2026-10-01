mod geometry;
mod hsl;
mod lut;
use wasm_bindgen::prelude::*;

/// Own the decoded source and smaller preview in WASM memory. Neither is edited
/// in place: every render starts from the immutable input.
#[wasm_bindgen]
pub struct ImageEngine {
    source: Vec<u8>,
    preview: Vec<u8>,
    lut: Option<lut::Lut>,
}

#[wasm_bindgen]
impl ImageEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(source: Vec<u8>, preview: Vec<u8>) -> Result<ImageEngine, JsValue> {
        if source.is_empty()
            || preview.is_empty()
            || source.len() % 4 != 0
            || preview.len() % 4 != 0
        {
            return Err(JsValue::from_str("Invalid RGBA image"));
        }
        Ok(Self {
            source,
            preview,
            lut: None,
        })
    }

    pub fn set_lut(
        &mut self,
        kind: u32,
        size: u32,
        domain: &[f32],
        data: Vec<f32>,
    ) -> Result<(), JsValue> {
        self.lut = Some(lut::Lut::new(kind, size, domain, data).map_err(JsValue::from_str)?);
        Ok(())
    }

    pub fn render(
        &self,
        values: &[f32],
        curve_values: &[f32],
        hsl_values: &[f32],
        look_values: &[f32],
        look_amount: f32,
        use_lut: bool,
        layout: &[u32],
        full_resolution: bool,
    ) -> Result<Vec<u8>, JsValue> {
        let settings = validate_settings(values).map_err(JsValue::from_str)?;
        let curves = parse_curves(curve_values).map_err(JsValue::from_str)?;
        let bands = hsl::parse(hsl_values).map_err(JsValue::from_str)?;
        if !look_amount.is_finite() || !(0.0..=2.0).contains(&look_amount) {
            return Err(JsValue::from_str("Invalid look amount"));
        }
        let look_curves = if !use_lut && look_amount > 0.0 {
            Some(parse_curves(look_values).map_err(JsValue::from_str)?)
        } else {
            None
        };
        let profile = if look_amount == 0.0 {
            None
        } else if use_lut {
            Some(Profile::Lut(self.lut.as_ref().ok_or_else(|| {
                JsValue::from_str("Import the required LUT file first")
            })?))
        } else {
            Some(Profile::Curves(look_curves.as_ref().unwrap()))
        };
        let input = if full_resolution {
            &self.source
        } else {
            &self.preview
        };
        let geometry = geometry::Layout::parse(layout, input.len()).map_err(JsValue::from_str)?;
        let mut output = geometry.transform(input);
        apply_adjustments_in_place(
            &mut output,
            &settings,
            &curves,
            &bands,
            profile,
            look_amount,
        );
        Ok(output)
    }

    pub fn retained_bytes(&self) -> usize {
        self.source.len() + self.preview.len() + self.lut.as_ref().map_or(0, |lut| lut.bytes())
    }
}

fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(value: f32) -> f32 {
    if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

fn validate_settings(values: &[f32]) -> Result<[f32; 6], &'static str> {
    if values.len() != 6 {
        return Err("Expected six adjustment values");
    }
    for (index, value) in values.iter().enumerate() {
        let limit = if index == 0 { 4.0 } else { 100.0 };
        if !value.is_finite() || value.abs() > limit {
            return Err("Adjustment is outside its supported range");
        }
    }
    Ok(values.try_into().unwrap())
}

type Curve = Vec<(f32, f32)>;
enum Profile<'a> {
    Curves(&'a [Curve; 4]),
    Lut(&'a lut::Lut),
}

fn parse_curves(values: &[f32]) -> Result<[Curve; 4], &'static str> {
    let mut offset = 0;
    let mut curves: [Curve; 4] = std::array::from_fn(|_| Vec::new());
    for curve in &mut curves {
        let count = *values.get(offset).ok_or("Missing curve points")?;
        if !count.is_finite() || count.fract() != 0.0 || !(2.0..=32.0).contains(&count) {
            return Err("Invalid curve point count");
        }
        offset += 1;
        for _ in 0..count as usize {
            let x = *values.get(offset).ok_or("Missing curve input")?;
            let y = *values.get(offset + 1).ok_or("Missing curve output")?;
            if !x.is_finite()
                || !y.is_finite()
                || !(0.0..=1.0).contains(&x)
                || !(0.0..=1.0).contains(&y)
            {
                return Err("Invalid curve point");
            }
            if curve.last().is_some_and(|(previous, _)| *previous >= x) {
                return Err("Curve inputs must increase");
            }
            curve.push((x, y));
            offset += 2;
        }
        if curve[0].0 != 0.0 || curve.last().unwrap().0 != 1.0 {
            return Err("Curve endpoints must span zero to one");
        }
    }
    if offset != values.len() {
        return Err("Unexpected curve data");
    }
    Ok(curves)
}

fn evaluate_curve(curve: &Curve, value: f32) -> f32 {
    for pair in curve.windows(2) {
        let [(x0, y0), (x1, y1)] = [pair[0], pair[1]];
        if value <= x1 {
            return y0 + (y1 - y0) * ((value - x0) / (x1 - x0)).clamp(0.0, 1.0);
        }
    }
    curve.last().unwrap().1
}

#[cfg(test)]
fn apply_adjustments(
    input: &[u8],
    settings: &[f32; 6],
    curves: &[Curve; 4],
    bands: &hsl::Bands,
) -> Vec<u8> {
    let mut output = input.to_vec();
    apply_adjustments_in_place(&mut output, settings, curves, bands, None, 0.0);
    output
}

fn apply_adjustments_in_place(
    output: &mut [u8],
    settings: &[f32; 6],
    curves: &[Curve; 4],
    bands: &hsl::Bands,
    profile: Option<Profile<'_>>,
    look_amount: f32,
) {
    if profile.is_none()
        && settings.iter().all(|v| *v == 0.0)
        && bands.iter().flatten().all(|v| *v == 0.0)
        && curves
            .iter()
            .all(|curve| curve.as_slice() == [(0.0, 0.0), (1.0, 1.0)])
    {
        return;
    }
    let [exposure, contrast, warmth, tint, saturation, vibrance] = *settings;
    let w = warmth / 100.0;
    let t = tint / 100.0;
    let mut balance = [
        2.0_f32.powf(0.4 * w + 0.2 * t),
        2.0_f32.powf(-0.2 * t),
        2.0_f32.powf(-0.4 * w + 0.2 * t),
    ];
    let normalization = balance[0] * 0.2126 + balance[1] * 0.7152 + balance[2] * 0.0722;
    for channel in &mut balance {
        *channel /= normalization;
    }
    let gain = 2.0_f32.powf(exposure);
    let slope = 2.0_f32.powf(contrast / 100.0);
    // Compose point transforms in float tables. Quantize only after the final
    // color operation, without retaining full-resolution float intermediates.
    let mut tables = [[0.0_f32; 256]; 3];
    for channel in 0..3 {
        for (i, entry) in tables[channel].iter_mut().enumerate() {
            let linear = srgb_to_linear(i as f32 / 255.0) * gain * balance[channel];
            let encoded = if exposure == 0.0 && warmth == 0.0 && tint == 0.0 {
                i as f32 / 255.0
            } else {
                linear_to_srgb(linear)
            };
            let tone = ((encoded - 0.5) * slope + 0.5).clamp(0.0, 1.0);
            *entry = evaluate_curve(&curves[channel + 1], evaluate_curve(&curves[0], tone));
        }
    }
    let mix_colors = bands.iter().flatten().any(|value| *value != 0.0);
    for pixel in output.chunks_exact_mut(4) {
        let rgb = [
            tables[0][pixel[0] as usize],
            tables[1][pixel[1] as usize],
            tables[2][pixel[2] as usize],
        ];
        let luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        let maximum = rgb[0].max(rgb[1]).max(rgb[2]);
        let minimum = rgb[0].min(rgb[1]).min(rgb[2]);
        let amount =
            (1.0 + saturation / 100.0) * (1.0 + vibrance / 100.0 * (1.0 - (maximum - minimum)));
        let mut color = if saturation == 0.0 && vibrance == 0.0 {
            rgb
        } else {
            rgb.map(|channel| (luma + (channel - luma) * amount).clamp(0.0, 1.0))
        };
        if mix_colors {
            color = hsl::apply(color, bands);
        }
        if let Some(profile) = &profile {
            let transformed = match profile {
                Profile::Lut(table) => table.apply(color),
                Profile::Curves(curves) => std::array::from_fn(|channel| {
                    evaluate_curve(
                        &curves[channel + 1],
                        evaluate_curve(&curves[0], color[channel]),
                    )
                }),
            };
            for channel in 0..3 {
                color[channel] += (transformed[channel] - color[channel]) * look_amount;
            }
        }
        for channel in 0..3 {
            pixel[channel] = (color[channel].clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const IDENTITY: [f32; 20] = [
        2.0, 0.0, 0.0, 1.0, 1.0, 2.0, 0.0, 0.0, 1.0, 1.0, 2.0, 0.0, 0.0, 1.0, 1.0, 2.0, 0.0, 0.0,
        1.0, 1.0,
    ];
    fn adjust(input: &[u8], settings: &[f32; 6]) -> Vec<u8> {
        apply_adjustments(
            input,
            settings,
            &parse_curves(&IDENTITY).unwrap(),
            &[[0.0; 3]; 8],
        )
    }
    #[test]
    fn curves_compose_master_then_channel_and_interpolate_linearly() {
        let mut curves = parse_curves(&IDENTITY).unwrap();
        curves[0] = vec![(0.0, 0.2), (1.0, 0.8)];
        curves[1] = vec![(0.0, 0.0), (1.0, 0.5)];
        assert_eq!(
            apply_adjustments(&[0, 0, 0, 127], &[0.0; 6], &curves, &[[0.0; 3]; 8]),
            [26, 51, 51, 127]
        );
        assert!((evaluate_curve(&curves[0], 0.5) - 0.5).abs() < 0.00001);
    }
    #[test]
    fn color_mix_preserves_exact_neutral_pipeline_endpoints() {
        let mut bands = [[0.0; 3]; 8];
        bands[3][1] = -100.0;
        assert_eq!(
            apply_adjustments(
                &[0, 255, 0, 128],
                &[0.0; 6],
                &parse_curves(&IDENTITY).unwrap(),
                &bands
            ),
            [128, 128, 128, 128]
        );
    }
    #[test]
    fn look_amount_blends_without_changing_alpha() {
        let table = lut::Lut::new(
            1,
            2,
            &[0., 0., 0., 1., 1., 1.],
            vec![1., 1., 1., 0., 0., 0.],
        )
        .unwrap();
        let mut pixels = vec![0, 255, 0, 123];
        apply_adjustments_in_place(
            &mut pixels,
            &[0.; 6],
            &parse_curves(&IDENTITY).unwrap(),
            &[[0.; 3]; 8],
            Some(Profile::Lut(&table)),
            0.5,
        );
        assert_eq!(pixels, [128, 128, 128, 123]);
    }
    #[test]
    fn malformed_curves_are_rejected() {
        assert!(parse_curves(&[]).is_err());
        let mut values = IDENTITY;
        values[3] = 0.0;
        assert!(parse_curves(&values).is_err());
        values = IDENTITY;
        values[2] = f32::NAN;
        assert!(parse_curves(&values).is_err());
    }
    fn exposure(value: f32) -> [f32; 6] {
        [value, 0.0, 0.0, 0.0, 0.0, 0.0]
    }

    #[test]
    fn identity_preserves_every_channel_value_and_alpha() {
        let pixels: Vec<u8> = (0..=255).flat_map(|x| [x, x, x, 173]).collect();
        assert_eq!(adjust(&pixels, &[0.0; 6]), pixels);
        let colors = [128, 64, 37, 128, 1, 240, 65, 0];
        assert_eq!(adjust(&colors, &[0.0; 6]), colors);
    }
    #[test]
    fn exposure_doubles_linear_light_not_srgb_values() {
        assert_eq!(
            adjust(&[128, 64, 0, 127], &exposure(1.0)),
            [176, 90, 0, 127]
        );
        assert_eq!(adjust(&[255, 128, 0, 0], &exposure(-1.0)), [188, 92, 0, 0]);
    }
    #[test]
    fn bright_values_clip_and_alpha_is_unchanged() {
        assert_eq!(
            adjust(&[240, 255, 0, 21], &exposure(4.0)),
            [255, 255, 0, 21]
        );
    }
    #[test]
    fn rendering_never_compounds_edits_or_mutates_the_original() {
        let source = vec![128, 64, 32, 255];
        let engine = ImageEngine::new(source.clone(), source.clone()).unwrap();
        let first = engine
            .render(
                &exposure(2.0),
                &IDENTITY,
                &[0.0; 24],
                &[],
                0.0,
                false,
                &[1, 1, 0, 0, 1, 1, 0],
                false,
            )
            .unwrap();
        assert_eq!(
            engine
                .render(
                    &exposure(2.0),
                    &IDENTITY,
                    &[0.0; 24],
                    &[],
                    0.0,
                    false,
                    &[1, 1, 0, 0, 1, 1, 0],
                    false
                )
                .unwrap(),
            first
        );
        assert_eq!(
            engine
                .render(
                    &exposure(0.0),
                    &IDENTITY,
                    &[0.0; 24],
                    &[],
                    0.0,
                    false,
                    &[1, 1, 0, 0, 1, 1, 0],
                    true
                )
                .unwrap(),
            source
        );
        assert_eq!(
            engine
                .render(
                    &exposure(-1.0),
                    &IDENTITY,
                    &[0.0; 24],
                    &[],
                    0.0,
                    false,
                    &[1, 1, 0, 0, 1, 1, 0],
                    false
                )
                .unwrap(),
            engine
                .render(
                    &exposure(-1.0),
                    &IDENTITY,
                    &[0.0; 24],
                    &[],
                    0.0,
                    false,
                    &[1, 1, 0, 0, 1, 1, 0],
                    true
                )
                .unwrap()
        );
    }
    #[test]
    fn saturation_removes_color_after_exposure() {
        assert_eq!(
            adjust(&[255, 0, 0, 91], &[-1.0, 0.0, 0.0, 0.0, -100.0, 0.0]),
            [40, 40, 40, 91]
        );
    }
    #[test]
    fn white_balance_and_contrast_have_the_expected_direction() {
        let warm = adjust(&[128, 128, 128, 255], &[0.0, 0.0, 100.0, 0.0, 0.0, 0.0]);
        assert!(warm[0] > warm[1] && warm[1] > warm[2]);
        let magenta = adjust(&[128, 128, 128, 255], &[0.0, 0.0, 0.0, 100.0, 0.0, 0.0]);
        assert!(magenta[0] > magenta[1] && magenta[2] > magenta[1]);
        let contrast = adjust(&[64, 128, 192, 255], &[0.0, 100.0, 0.0, 0.0, 0.0, 0.0]);
        assert!(contrast[0] < 64 && contrast[2] > 192);
    }
    #[test]
    fn vibrance_preserves_neutrals_and_affects_muted_colors_more() {
        assert_eq!(
            adjust(&[128, 128, 128, 255], &[0.0, 0.0, 0.0, 0.0, 0.0, 100.0]),
            [128, 128, 128, 255]
        );
        assert_eq!(
            adjust(&[255, 0, 0, 255], &[0.0, 0.0, 0.0, 0.0, 0.0, 100.0]),
            [255, 0, 0, 255]
        );
        assert_ne!(
            adjust(&[150, 100, 100, 255], &[0.0, 0.0, 0.0, 0.0, 0.0, 100.0]),
            [150, 100, 100, 255]
        );
    }
    #[test]
    fn invalid_values_are_rejected() {
        assert!(validate_settings(&[0.0; 5]).is_err());
        assert!(validate_settings(&exposure(f32::NAN)).is_err());
        assert!(validate_settings(&exposure(5.0)).is_err());
        assert!(validate_settings(&[0.0, 101.0, 0.0, 0.0, 0.0, 0.0]).is_err());
    }
}
