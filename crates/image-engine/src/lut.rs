pub struct Lut {
    kind: u32,
    size: usize,
    domain: [f32; 6],
    data: Vec<f32>,
}
impl Lut {
    pub fn bytes(&self) -> usize {
        self.data.len() * std::mem::size_of::<f32>()
    }
    pub fn new(kind: u32, size: u32, domain: &[f32], data: Vec<f32>) -> Result<Self, &'static str> {
        let size = size as usize;
        if ![1, 3].contains(&kind)
            || size < 2
            || size > if kind == 3 { 65 } else { 65536 }
            || domain.len() != 6
        {
            return Err("Invalid LUT dimensions");
        }
        let count = if kind == 3 { size * size * size } else { size } * 3;
        if data.len() != count
            || data.iter().any(|v| !v.is_finite() || v.abs() > 16.0)
            || domain.iter().any(|v| !v.is_finite() || v.abs() > 65536.0)
            || (0..3).any(|i| domain[i] >= domain[i + 3])
        {
            return Err("Invalid LUT data or domain");
        }
        Ok(Self {
            kind,
            size,
            domain: domain.try_into().unwrap(),
            data,
        })
    }
    pub fn apply(&self, rgb: [f32; 3]) -> [f32; 3] {
        let position: [f32; 3] = std::array::from_fn(|c| {
            ((rgb[c] - self.domain[c]) / (self.domain[c + 3] - self.domain[c])).clamp(0.0, 1.0)
                * (self.size - 1) as f32
        });
        let low = position.map(|v| (v.floor() as usize).min(self.size - 2));
        let fraction: [f32; 3] = std::array::from_fn(|c| position[c] - low[c] as f32);
        if self.kind == 1 {
            return std::array::from_fn(|c| {
                let a = self.data[low[c] * 3 + c];
                let b = self.data[(low[c] + 1) * 3 + c];
                a + (b - a) * fraction[c]
            });
        }
        let mut output = [0.0; 3];
        for z in 0..2 {
            for y in 0..2 {
                for x in 0..2 {
                    let weight = (if x == 0 {
                        1.0 - fraction[0]
                    } else {
                        fraction[0]
                    }) * (if y == 0 {
                        1.0 - fraction[1]
                    } else {
                        fraction[1]
                    }) * (if z == 0 {
                        1.0 - fraction[2]
                    } else {
                        fraction[2]
                    });
                    let offset = ((low[0] + x)
                        + (low[1] + y) * self.size
                        + (low[2] + z) * self.size * self.size)
                        * 3;
                    for c in 0..3 {
                        output[c] += self.data[offset + c] * weight;
                    }
                }
            }
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interpolates_1d_and_3d_tables_with_red_fastest_order() {
        let one = Lut::new(
            1,
            2,
            &[0., 0., 0., 1., 1., 1.],
            vec![1., 1., 1., 0., 0., 0.],
        )
        .unwrap();
        assert_eq!(one.apply([0.25, 0.5, 0.75]), [0.75, 0.5, 0.25]);
        let mut data = Vec::new();
        for b in 0..2 {
            for g in 0..2 {
                for r in 0..2 {
                    data.extend([b as f32, g as f32, r as f32]);
                }
            }
        }
        let cube = Lut::new(3, 2, &[0., 0., 0., 1., 1., 1.], data).unwrap();
        assert_eq!(cube.apply([0.25, 0.5, 0.75]), [0.75, 0.5, 0.25]);
        assert_eq!(cube.apply([1., 0., 0.]), [0., 0., 1.]);
    }
    #[test]
    fn validates_size_domain_and_data() {
        assert!(Lut::new(3, 66, &[0., 0., 0., 1., 1., 1.], vec![]).is_err());
        assert!(Lut::new(1, 2, &[0., 0., 0., 0., 1., 1.], vec![0.; 6]).is_err());
        assert!(Lut::new(1, 2, &[0., 0., 0., 1., 1., 1.], vec![f32::NAN; 6]).is_err());
    }
}
