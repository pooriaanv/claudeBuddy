//! Monitor list in physical pixels and change detection for the `screens-changed` event
//! (12-windows-plan.md section 3, port of `NSApplication.didChangeScreenParametersNotification`).

use serde::Serialize;
use std::time::Duration;
use tauri::Emitter;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RectDto {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorDto {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub work_area: RectDto,
    pub scale: f64,
}

/// Every monitor in physical pixels with its work area and scale.
pub fn collect(app: &tauri::AppHandle) -> Result<Vec<MonitorDto>, String> {
    let list = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(list
        .iter()
        .map(|m| {
            let wa = m.work_area();
            MonitorDto {
                x: m.position().x,
                y: m.position().y,
                width: m.size().width,
                height: m.size().height,
                work_area: RectDto {
                    x: wa.position.x,
                    y: wa.position.y,
                    width: wa.size.width,
                    height: wa.size.height,
                },
                scale: m.scale_factor(),
            }
        })
        .collect())
}

/// Remembers the last monitor list. `update` says whether a new list differs from it (monitor added / removed /
/// moved / resized, work area changed because the taskbar moved or resized, scale changed). The order of the list
/// does not matter, and the very first list is only remembered.
#[derive(Default)]
pub struct ScreenWatcher {
    last: Option<Vec<MonitorDto>>,
}

fn normalized(mut list: Vec<MonitorDto>) -> Vec<MonitorDto> {
    list.sort_by_key(|m| (m.x, m.y, m.width, m.height));
    list
}

impl ScreenWatcher {
    pub fn update(&mut self, current: Vec<MonitorDto>) -> bool {
        let current = normalized(current);
        let changed = matches!(&self.last, Some(last) if *last != current);
        self.last = Some(current);
        changed
    }
}

/// Polls the monitor list every 2 s and emits `screens-changed` when it changed (12-windows-plan.md section 3).
pub fn spawn_watcher(app: tauri::AppHandle) {
    let _ = std::thread::Builder::new().name("screens-watch".into()).spawn(move || {
        let mut watcher = ScreenWatcher::default();
        loop {
            if let Ok(list) = collect(&app) {
                if watcher.update(list) {
                    let _ = app.emit("screens-changed", ());
                }
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, width: u32, work_h: u32, scale: f64) -> MonitorDto {
        MonitorDto {
            x,
            y: 0,
            width,
            height: 1440,
            work_area: RectDto { x, y: 0, width, height: work_h },
            scale,
        }
    }

    #[test]
    fn first_list_is_only_remembered() {
        let mut w = ScreenWatcher::default();
        assert!(!w.update(vec![monitor(0, 3440, 1392, 1.0)]));
    }

    #[test]
    fn same_list_is_not_a_change_even_when_reordered() {
        let mut w = ScreenWatcher::default();
        let a = monitor(0, 3440, 1392, 1.0);
        let b = monitor(3440, 1920, 1040, 1.0);
        w.update(vec![a.clone(), b.clone()]);
        assert!(!w.update(vec![a.clone(), b.clone()]));
        assert!(!w.update(vec![b, a]));
    }

    #[test]
    fn work_area_scale_and_monitor_count_changes_are_detected() {
        let mut w = ScreenWatcher::default();
        w.update(vec![monitor(0, 3440, 1392, 1.0)]);
        // taskbar made taller -> smaller work area
        assert!(w.update(vec![monitor(0, 3440, 1344, 1.0)]));
        // same again -> no change
        assert!(!w.update(vec![monitor(0, 3440, 1344, 1.0)]));
        // scale changed
        assert!(w.update(vec![monitor(0, 3440, 1344, 1.5)]));
        // second monitor plugged in
        assert!(w.update(vec![monitor(0, 3440, 1344, 1.5), monitor(3440, 1920, 1040, 1.0)]));
        // and unplugged
        assert!(w.update(vec![monitor(0, 3440, 1344, 1.5)]));
    }
}
