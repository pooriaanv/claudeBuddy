//! Pure window geometry (physical pixels, y down). No Win32 here, so it is unit-testable.

/// Mac `SceneRenderer.design`: the 240x320 design canvas (character space 200x300 plus margins).
pub const DESIGN_WIDTH: f64 = 240.0;
pub const DESIGN_HEIGHT: f64 = 320.0;

/// Mac `Preferences.size` default: the window is 150 pt wide on the desktop.
pub const DEFAULT_SIZE_PT: f64 = 150.0;

/// Mac `PetController.init`: initial `centerX = visibleFrame.maxX - 120` (points).
pub const DEFAULT_CENTER_X_INSET_PT: f64 = 120.0;

/// Mac `PetController.idleFrame`: the window bottom sits `h * 0.035` below the floor (work-area bottom).
pub const FLOOR_SINK: f64 = 0.035;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn right(&self) -> i32 {
        self.x + self.w
    }
    pub fn bottom(&self) -> i32 {
        self.y + self.h
    }
    /// Half-open containment like Win32 rectangles: left/top inclusive, right/bottom exclusive.
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.right() && py >= self.y && py < self.bottom()
    }
}

/// port of `PetController.idleFrame` (12-windows-plan.md D5), in physical pixels:
/// width = `size_pt * scale`, height = `w * 320 / 240`, `x` clamps `center_x` into the work area,
/// `y = wa.bottom + round(h * 0.035) - h` (Mac y points up; here it points down).
pub fn idle_frame(work_area: Rect, scale: f64, size_pt: f64, center_x: f64) -> Rect {
    let w = (size_pt * scale).round() as i32;
    let h = (w as f64 * DESIGN_HEIGHT / DESIGN_WIDTH).round() as i32;
    let half = w as f64 / 2.0;
    // Mac: min(vf.maxX - w/2, max(vf.minX + w/2, centerX))
    let cx = (work_area.x as f64 + half).max(center_x).min(work_area.right() as f64 - half);
    Rect {
        x: (cx - half).round() as i32,
        y: work_area.bottom() + (h as f64 * FLOOR_SINK).round() as i32 - h,
        w,
        h,
    }
}

/// Mac default `centerX` (no saved `petX`): `workArea.maxX - 120 pt`, in physical pixels.
pub fn default_center_x(work_area: Rect, scale: f64) -> f64 {
    work_area.right() as f64 - DEFAULT_CENTER_X_INSET_PT * scale
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_frame_dev_machine_100_percent() {
        // 3440x1440 monitor, taskbar 48 px at the bottom -> work area 3440x1392.
        let wa = Rect { x: 0, y: 0, w: 3440, h: 1392 };
        let f = idle_frame(wa, 1.0, DEFAULT_SIZE_PT, default_center_x(wa, 1.0));
        assert_eq!(f, Rect { x: 3245, y: 1199, w: 150, h: 200 });
        assert_eq!(f.bottom(), wa.bottom() + 7);
    }

    #[test]
    fn idle_frame_scales_with_dpi() {
        let wa = Rect { x: 0, y: 0, w: 2560, h: 1360 };
        let f = idle_frame(wa, 1.5, DEFAULT_SIZE_PT, default_center_x(wa, 1.5));
        assert_eq!((f.w, f.h), (225, 300));
        assert_eq!(f.bottom(), wa.bottom() + 11); // round(300 * 0.035) = 11 (10.5 rounds up)
        assert_eq!(f.x + f.w / 2, 2560 - 180); // centerX = right - 120 * 1.5 (within 1 px of rounding)
    }

    #[test]
    fn contains_is_half_open() {
        let r = Rect { x: 10, y: 20, w: 5, h: 4 };
        assert!(r.contains(10, 20));
        assert!(r.contains(14, 23));
        assert!(!r.contains(15, 23));
        assert!(!r.contains(14, 24));
        assert!(!r.contains(9, 20));
    }

    #[test]
    fn idle_frame_clamps_into_work_area() {
        let wa = Rect { x: 100, y: 0, w: 1000, h: 800 };
        let left = idle_frame(wa, 1.0, DEFAULT_SIZE_PT, -500.0);
        assert_eq!(left.x, 100);
        let right = idle_frame(wa, 1.0, DEFAULT_SIZE_PT, 5000.0);
        assert_eq!(right.right(), 1100);
    }
}
