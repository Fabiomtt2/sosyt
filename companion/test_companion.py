import os
import time
import unittest
from sos_companion import CompanionApi, CompanionWindow, Observation, TimerTracker, parse_timer, recognize_timer, validate_server


class CompanionTests(unittest.TestCase):
    def test_counter_parsing_and_impossible_values(self):
        self.assertEqual(parse_timer("0:12 / 2:00"), (12, 120))
        self.assertEqual(parse_timer("1:02:03 / 2:00:00"), (3723, 7200))
        for value in ("1:90 / 2:00", "3:00 / 2:00", "0:00 / 0:00", "publicidade", "1234:56 / 12:00"):
            self.assertIsNone(parse_timer(value))

    def test_natural_progress_pause_seek_and_video_change(self):
        tracker = TimerTracker()
        self.assertEqual(tracker.observe((0, 120), 0).signal, "PAUSED")
        self.assertEqual(tracker.observe((5, 120), 5).signal, "ADVANCING")
        self.assertEqual(tracker.observe((5, 120), 10).signal, "PAUSED")
        self.assertEqual(tracker.observe((80, 120), 15).signal, "UNREADABLE")
        self.assertEqual(tracker.observe(None, 20).signal, "UNREADABLE")
        self.assertEqual(tracker.observe((90, 120), 25).signal, "PAUSED")
        self.assertEqual(tracker.observe((0, 300), 30).signal, "PAUSED")
        self.assertEqual(tracker.observe((30, 300), 60).signal, "UNREADABLE")

    def test_metadata_only_and_https(self):
        self.assertEqual(Observation("ADVANCING", 5, 120).payload(1), {
            "sequence": 1, "signal": "ADVANCING", "positionSeconds": 5, "durationSeconds": 120})
        self.assertEqual(validate_server("https://example.org/"), "https://example.org")
        self.assertEqual(validate_server("http://127.0.0.1:3333"), "http://127.0.0.1:3333")
        for value in ("http://example.org", "file:///etc/passwd", "https://user:pass@example.org", "https://example.org?token=x"):
            with self.assertRaises(ValueError):
                validate_server(value)

    @unittest.skipUnless(os.environ.get("SOS_TESSERACT"), "Optional actual OCR integration")
    def test_real_tesseract_reads_fixture(self):
        from PIL import Image, ImageDraw, ImageFont
        frame = Image.new("RGB", (360, 65), "white")
        ImageDraw.Draw(frame).text((10, 8), "0:12 / 2:00", fill="black",
            font=ImageFont.truetype("DejaVuSans.ttf", 36))
        self.assertEqual(recognize_timer(frame, os.environ["SOS_TESSERACT"]), (12, 120))
        frame.close()

    @unittest.skipUnless(os.environ.get("SOS_GUI_TEST"), "Optional isolated display integration")
    def test_real_window_opt_in_and_selected_capture(self):
        import tkinter as tk
        from PIL import ImageGrab
        root = tk.Tk()
        window = CompanionWindow(root)
        root.update()
        self.assertFalse(window.running)
        self.assertEqual(str(window.start_button["state"]), "disabled")
        self.assertIsNone(window.region)
        if evidence := os.environ.get("SOS_GUI_EVIDENCE"):
            frame = ImageGrab.grab(bbox=(root.winfo_rootx(),root.winfo_rooty(),root.winfo_rootx()+root.winfo_width(),root.winfo_rooty()+root.winfo_height()))
            frame.save(evidence)
            frame.close()
        # Dedicated test-only window on Xvfb; never captures the user's desktop.
        fixture = tk.Toplevel(root)
        fixture.geometry("360x80+20+20")
        label = tk.Label(fixture, text="0:12 / 2:00", font=("DejaVu Sans", 28), fg="black", bg="white")
        label.pack(fill="both", expand=True)
        root.update()
        time.sleep(0.2)
        box = (label.winfo_rootx(), label.winfo_rooty(), label.winfo_rootx()+label.winfo_width(), label.winfo_rooty()+label.winfo_height())
        frame = ImageGrab.grab(bbox=box)
        self.assertEqual(recognize_timer(frame, os.environ["SOS_TESSERACT"]), (12, 120))
        frame.close()
        window.consent.set(True)
        window.region = box
        window.consent.set(False)
        window.consent_changed()
        self.assertIsNone(window.region)
        window.close()


if __name__ == "__main__":
    unittest.main()
