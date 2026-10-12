#!/usr/bin/env python3
"""SOS YouTuber companion — explicit local screen-region observation, no image upload.
Requires Python 3.10+, tkinter, Pillow and the Tesseract executable.
New implementation (2026-10-07), not a recovered historical IFtp runtime.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import queue
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

INTERVAL = 5.0


def parse_clock(value: str) -> int:
    parts = [int(piece) for piece in value.split(":")]
    if len(parts) not in (2, 3) or any(piece >= 60 for piece in parts[1:]):
        raise ValueError("Tempo inválido")
    return sum(piece * 60 ** index for index, piece in enumerate(reversed(parts)))


def parse_timer(text: str) -> tuple[int, int] | None:
    match = re.search(r"(?<![\d:])(\d{1,3}:\d{2}(?::\d{2})?)\s*/\s*(\d{1,3}:\d{2}(?::\d{2})?)(?![\d:])", text)
    if not match:
        return None
    try:
        position, duration = (parse_clock(value) for value in match.groups())
        return (position, duration) if 0 <= position <= duration <= 86400 and duration else None
    except ValueError:
        return None


@dataclass
class Observation:
    signal: str
    position: int | None = None
    duration: int | None = None

    def payload(self, sequence: int) -> dict:
        result = {"sequence": sequence, "signal": self.signal}
        if self.position is not None:
            result.update(positionSeconds=self.position, durationSeconds=self.duration)
        return result


class TimerTracker:
    def __init__(self):
        self.previous = None

    def observe(self, timer: tuple[int, int] | None, now: float) -> Observation:
        previous, self.previous = self.previous, (timer, now) if timer else None
        if timer is None:
            return Observation("UNREADABLE")
        position, duration = timer
        signal = "PAUSED"
        if previous and previous[0] and previous[0][1] == duration:
            elapsed = now - previous[1]
            delta = position - previous[0][0]
            if 0 < elapsed <= 15 and 0 < delta <= elapsed * 1.15 + 1:
                signal = "ADVANCING"
            elif delta != 0:
                signal = "UNREADABLE"
        return Observation(signal, position, duration)


def recognize_timer(frame, executable: str = "tesseract") -> tuple[int, int] | None:
    # Only the selected region exists in memory. stdin/stdout avoid screenshot files.
    from PIL import ImageOps
    gray = ImageOps.grayscale(frame)
    gray = gray.resize((gray.width * 3, gray.height * 3))
    buffer = io.BytesIO()
    gray.save(buffer, format="PNG")
    result = subprocess.run(
        [executable, "stdin", "stdout", "--psm", "7", "-l", "eng",
         "-c", "tessedit_char_whitelist=0123456789:/"],
        input=buffer.getvalue(), capture_output=True, timeout=8, check=True)
    return parse_timer(result.stdout.decode("utf-8", errors="replace"))


def validate_server(value: str) -> str:
    parsed = urllib.parse.urlsplit(value.strip())
    local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("Use o endereço HTTPS mostrado no webapp.")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("Copie apenas o endereço do servidor mostrado no webapp.")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Redirecionamento recusado. Confira o endereço no webapp.")


class ApiError(Exception):
    def __init__(self, status: int, message: str, data: dict):
        super().__init__(message)
        self.status, self.data = status, data


class CompanionApi:
    def __init__(self, server: str):
        self.server = validate_server(server)
        self.token = None  # Memory only; closing requires a fresh pairing.
        self.sequence = 1
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path: str, payload: dict | None = None, method: str | None = None):
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.server + path, headers=headers,
            data=json.dumps(payload).encode() if payload is not None else None, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                return json.loads(response.read(65536))
        except urllib.error.HTTPError as error:
            try:
                data = json.loads(error.read(65536))
            except (ValueError, OSError):
                data = {}
            raise ApiError(error.code, data.get("message", "Servidor indisponível."), data) from None

    def pair(self, code: str):
        result = self.request("/companion/pair", {"code": code.strip()})
        self.token = result["deviceToken"]
        return result

    def observe(self, observation: Observation):
        try:
            result = self.request("/companion/observations", observation.payload(self.sequence))
        except ApiError as error:
            if error.status == 409:
                self.sequence = error.data.get("nextSequence", self.sequence + 1)
            raise
        self.sequence = result["nextSequence"]
        return result


class CompanionWindow:
    def __init__(self, root, executable="tesseract"):
        import tkinter as tk
        from tkinter import ttk
        self.tk, self.ttk, self.root, self.executable = tk, ttk, root, executable
        self.api = None
        self.region = None
        self.running = False
        self.timer_id = None
        self.busy = False
        self.closed = False
        self.events = queue.Queue()
        self.tracker = TimerTracker()
        root.title("SOS YouTuber · Acompanhamento opcional")
        root.geometry("660x590")
        root.minsize(560, 560)
        root.protocol("WM_DELETE_WINDOW", self.close)
        panel = ttk.Frame(root, padding=24)
        panel.pack(fill="both", expand=True)
        ttk.Label(panel, text="Seu acompanhamento, sob seu controle", font=("", 17, "bold")).pack(anchor="w")
        ttk.Label(panel, wraplength=585, text="Selecione somente o contador de tempo do player. Imagens ficam neste computador; o servidor recebe apenas tempos e estado da leitura. Isso não comprova atenção humana.").pack(anchor="w", pady=(12, 16))
        self.consent = tk.BooleanVar(value=False)
        ttk.Checkbutton(panel, text="Autorizo observar a região que eu selecionar.", variable=self.consent, command=self.consent_changed).pack(anchor="w")
        ttk.Label(panel, text="Endereço do servidor (copie do webapp)").pack(anchor="w", pady=(18, 4))
        self.server = ttk.Entry(panel)
        self.server.pack(fill="x")
        ttk.Label(panel, text="Código de conexão do webapp · válido por 5 minutos").pack(anchor="w", pady=(12, 4))
        self.code = ttk.Entry(panel, show="•")
        self.code.pack(fill="x")
        actions = ttk.Frame(panel)
        actions.pack(fill="x", pady=16)
        self.pair_button = ttk.Button(actions, text="Conectar", command=self.pair)
        self.pair_button.pack(side="left")
        self.select_button = ttk.Button(actions, text="Selecionar região", command=self.select_region)
        self.select_button.pack(side="left", padx=8)
        self.start_button = ttk.Button(actions, text="Iniciar", command=self.start)
        self.start_button.pack(side="left")
        self.stop_button = ttk.Button(actions, text="Parar", command=self.stop)
        self.stop_button.pack(side="left", padx=8)
        self.disconnect_button = ttk.Button(panel, text="Desconectar este computador", command=self.disconnect)
        self.disconnect_button.pack(anchor="w")
        self.status = tk.StringVar(value="Parado. Nenhuma captura iniciada.")
        ttk.Label(panel, textvariable=self.status, wraplength=585).pack(anchor="w", pady=8)
        self.rewards = tk.StringVar(value="O saldo e o tempo acumulado serão consultados no servidor.")
        ttk.Label(panel, textvariable=self.rewards, wraplength=585).pack(anchor="w", pady=8)
        ttk.Label(panel, wraplength=585, text="Mantenha o player do webapp aberto e visível. Se o contador desaparecer ou você mover a janela, pare e selecione novamente. Você pode parar ou fechar a qualquer momento. Este programa não controla a reprodução, não clica e não concede moedas sozinho.").pack(anchor="w", pady=12)
        self.refresh_controls()
        root.after(100, self.drain)

    def refresh_controls(self):
        self.start_button.configure(state="normal" if self.consent.get() and self.api and self.region and not self.running and not self.busy else "disabled")
        self.pair_button.configure(state="disabled" if self.running or self.busy or self.api else "normal")
        self.select_button.configure(state="normal" if self.consent.get() and not self.running and not self.busy else "disabled")
        self.stop_button.configure(state="normal" if self.running else "disabled")
        self.disconnect_button.configure(state="normal" if self.api and not self.running and not self.busy else "disabled")

    def consent_changed(self):
        if not self.consent.get():
            self.stop()
            self.region = None
        self.refresh_controls()

    def background(self, work, done):
        self.busy = True
        self.refresh_controls()
        def execute():
            try:
                self.events.put((done, work(), None))
            except Exception as error:
                self.events.put((done, None, error))
        threading.Thread(target=execute, daemon=True).start()

    def drain(self):
        while not self.events.empty():
            done, result, error = self.events.get_nowait()
            self.busy = False
            done(result, error)
            self.refresh_controls()
        if not self.closed:
            self.root.after(100, self.drain)

    def pair(self):
        try:
            client = CompanionApi(self.server.get())
        except ValueError as error:
            self.status.set(str(error))
            return
        code = self.code.get()
        def complete(result, error):
            if error:
                self.status.set("Conexão não concluída: " + str(error))
            else:
                self.api = client
                self.code.delete(0, "end")
                self.server.configure(state="disabled")
                self.status.set("Conectado. Selecione o contador e clique em Iniciar.")
        self.background(lambda: client.pair(code), complete)

    def select_region(self):
        if not self.consent.get():
            return
        tk = self.tk
        overlay = tk.Toplevel(self.root)
        overlay.attributes("-fullscreen", True)
        overlay.attributes("-topmost", True)
        overlay.attributes("-alpha", 0.35)
        canvas = tk.Canvas(overlay, bg="#102039", cursor="crosshair")
        canvas.pack(fill="both", expand=True)
        canvas.create_text(30, 30, anchor="nw", fill="white", text="Arraste sobre o contador (ex.: 0:12 / 2:00). Esc cancela.")
        selection = {}
        def press(event):
            selection.update(x=event.x_root, y=event.y_root, item=canvas.create_rectangle(event.x, event.y, event.x, event.y, outline="yellow", width=3))
        def motion(event):
            if "item" in selection:
                canvas.coords(selection["item"], selection["x"]-overlay.winfo_rootx(), selection["y"]-overlay.winfo_rooty(), event.x, event.y)
        def release(event):
            if "x" in selection:
                box = (min(selection["x"], event.x_root), min(selection["y"], event.y_root), max(selection["x"], event.x_root), max(selection["y"], event.y_root))
                if 30 <= box[2]-box[0] <= 1200 and 10 <= box[3]-box[1] <= 300:
                    self.region = box
                    self.status.set("Região selecionada. Captura ainda parada.")
                else:
                    self.status.set("Selecione apenas o contador, em uma região menor.")
            overlay.destroy()
            self.refresh_controls()
        canvas.bind("<ButtonPress-1>", press)
        canvas.bind("<B1-Motion>", motion)
        canvas.bind("<ButtonRelease-1>", release)
        overlay.bind("<Escape>", lambda event: overlay.destroy())
        overlay.focus_set()

    def start(self):
        if self.busy or not self.api or not self.region or not self.consent.get():
            return
        self.tracker = TimerTracker()
        self.running = True
        self.status.set("Observação ativa · somente a região selecionada · a cada 5 segundos.")
        self.refresh_controls()
        self.tick()

    def tick(self):
        self.timer_id = None
        if not self.running or self.busy:
            return
        box, client = self.region, self.api
        def observe():
            from PIL import ImageGrab
            frame = ImageGrab.grab(bbox=box)
            try:
                timer = recognize_timer(frame, self.executable)
            finally:
                frame.close()
            observation = self.tracker.observe(timer, time.monotonic())
            # Stop/withdrawal during OCR prevents a new network submission.
            if not self.running:
                return None
            return observation, client.observe(observation)
        def complete(result, error):
            if error:
                self.running = False
                self.status.set("Observação interrompida: " + str(error))
                if isinstance(error, ApiError) and error.status == 401:
                    self.api = None
                    self.server.configure(state="normal")
            elif result and self.running:
                observation, response = result
                states = {"ADVANCING": "Contador avançando", "PAUSED": "Sem avanço confirmado", "UNREADABLE": "Contador não reconhecido"}
                match = "compatível com o player" if response["playerMatches"] else "sem correspondência confirmada com o player"
                self.status.set(states[observation.signal] + " · " + match)
                reward = response["rewards"]
                self.rewards.set(f"Servidor: {reward['verifiedSeconds'] // 60} min acumulados · {reward['coins']} moedas por tempo · próxima moeda em {reward['secondsToNextReward']} s.")
            if self.running:
                self.timer_id = self.root.after(int(INTERVAL * 1000), self.tick)
            elif client:
                # Serialize STOPPED after any in-flight observation.
                self.background(lambda: client.observe(Observation("STOPPED")), lambda result, error: None)
        self.background(observe, complete)

    def stop(self):
        if self.timer_id is not None:
            self.root.after_cancel(self.timer_id)
            self.timer_id = None
        was_running = self.running
        self.running = False
        self.status.set("Parado. Nenhuma nova captura será feita.")
        self.refresh_controls()
        if was_running and not self.busy and self.api:
            client = self.api
            self.background(lambda: client.observe(Observation("STOPPED")), lambda result, error: None)

    def disconnect(self):
        if not self.api or self.running or self.busy:
            return
        client = self.api
        def complete(result, error):
            if error and not (isinstance(error, ApiError) and error.status == 401):
                self.status.set("Não foi possível revogar agora. Tente novamente ou use o webapp.")
            else:
                client.token = None
                self.api = None
                self.server.configure(state="normal")
                self.status.set("Autorização revogada. Nenhuma captura ativa.")
        self.background(lambda: client.request("/companion/device", method="DELETE"), complete)

    def close(self):
        self.stop()
        self.closed = True
        if self.api:
            self.api.token = None
        self.root.destroy()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tesseract", default=os.environ.get("SOS_TESSERACT", "tesseract"))
    args = parser.parse_args()
    import tkinter as tk
    root = tk.Tk()
    CompanionWindow(root, args.tesseract)
    root.mainloop()


if __name__ == "__main__":
    main()
