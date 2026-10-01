use wasm_bindgen::prelude::*;

/// Own the decoded source and smaller preview in WASM memory. Neither is edited
/// in place: every render starts from the immutable input.
#[wasm_bindgen]
pub struct ImageEngine {
    source: Vec<u8>,
    preview: Vec<u8>,
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
        Ok(Self { source, preview })
    }

    pub fn render(&self, exposure: f32, full_resolution: bool) -> Result<Vec<u8>, JsValue> {
        if !exposure.is_finite() || !(-4.0..=4.0).contains(&exposure) {
            return Err(JsValue::from_str("Exposure must be between -4 and +4 EV"));
        }
        Ok(apply_exposure(
            if full_resolution {
                &self.source
            } else {
                &self.preview
            },
            exposure,
        ))
    }

    pub fn retained_bytes(&self) -> usize {
        self.source.len() + self.preview.len()
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

fn apply_exposure(input: &[u8], exposure: f32) -> Vec<u8> {
    // With a single point operation on 8-bit input, a float-computed lookup table
    // is equivalent to per-pixel float math, without full-image float buffers.
    let gain = 2.0_f32.powf(exposure);
    let mut table = [0u8; 256];
    for (i, value) in table.iter_mut().enumerate() {
        let linear = srgb_to_linear(i as f32 / 255.0) * gain;
        *value = (linear_to_srgb(linear.clamp(0.0, 1.0)) * 255.0).round() as u8;
    }
    let mut output = input.to_vec();
    for pixel in output.chunks_exact_mut(4) {
        pixel[0] = table[pixel[0] as usize];
        pixel[1] = table[pixel[1] as usize];
        pixel[2] = table[pixel[2] as usize];
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_preserves_every_channel_value_and_alpha() {
        let pixels: Vec<u8> = (0..=255).flat_map(|x| [x, x, x, 173]).collect();
        assert_eq!(apply_exposure(&pixels, 0.0), pixels);
    }

    #[test]
    fn exposure_doubles_linear_light_not_srgb_values() {
        assert_eq!(apply_exposure(&[128, 64, 0, 127], 1.0), [176, 90, 0, 127]);
        assert_eq!(apply_exposure(&[255, 128, 0, 0], -1.0), [188, 92, 0, 0]);
    }

    #[test]
    fn bright_values_clip_and_alpha_is_unchanged() {
        assert_eq!(apply_exposure(&[240, 255, 0, 21], 4.0), [255, 255, 0, 21]);
    }

    #[test]
    fn rendering_never_compounds_edits_or_mutates_the_original() {
        let source = vec![128, 64, 32, 255];
        let engine = ImageEngine::new(source.clone(), source.clone()).unwrap();
        let first = engine.render(2.0, false).unwrap();
        assert_eq!(engine.render(2.0, false).unwrap(), first);
        assert_eq!(engine.render(0.0, true).unwrap(), source);
        assert_eq!(
            engine.render(-1.0, false).unwrap(),
            engine.render(-1.0, true).unwrap()
        );
    }
}
