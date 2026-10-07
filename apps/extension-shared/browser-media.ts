import {
  inspectPngHeader,
  type ScreenshotEdit,
  transformScreenshot,
} from "../../packages/capture-core/pixels.ts";

const MAX_PNG = 16 * 1024 ** 2;
const MAX_VIDEO = 64 * 1024 ** 2;
export function decodeCapture(data: string): Uint8Array<ArrayBuffer> {
  const prefix = "data:image/png;base64,";
  if (!data.startsWith(prefix) || data.length > prefix.length + Math.ceil(MAX_PNG / 3) * 4)
    throw new Error("Capture PNG refusée");
  const raw = atob(data.slice(prefix.length));
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  inspectPngHeader(bytes);
  return bytes;
}
export async function editPng(
  bytes: Uint8Array<ArrayBuffer>,
  edit: ScreenshotEdit,
): Promise<Uint8Array<ArrayBuffer>> {
  const dimensions = inspectPngHeader(bytes);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  try {
    if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height)
      throw new Error("Dimensions incohérentes");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas indisponible");
    context.drawImage(bitmap, 0, 0);
    const source = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const result = transformScreenshot(
      { width: bitmap.width, height: bitmap.height, pixels: new Uint8Array(source.data) },
      edit,
    );
    canvas.width = result.width;
    canvas.height = result.height;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height),
      0,
      0,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Encodage PNG refusé"))),
        "image/png",
      ),
    );
    if (blob.size > MAX_PNG) throw new Error("Capture supérieure à 16 Mio");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}
export class Recording {
  #stream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #epoch = 0;
  #pending = false;
  #chunks: Blob[] = [];
  #bytes = 0;
  constructor(
    private readonly acquire = (audio: boolean) =>
      navigator.mediaDevices.getDisplayMedia({ video: true, audio }),
    private readonly create = (stream: MediaStream) => new MediaRecorder(stream),
  ) {}
  private release() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
  }
  cancel(): void {
    this.#epoch++;
    this.release();
    if (this.#recorder?.state !== "inactive") this.#recorder?.stop();
    this.#chunks = [];
  }
  async start(
    audio: boolean,
    changed: (state: string, blob?: Blob, audioCaptured?: boolean) => void,
  ): Promise<void> {
    if (this.#pending || this.#stream) throw new Error("Enregistrement déjà actif");
    const epoch = ++this.#epoch;
    this.#pending = true;
    try {
      const stream = await this.acquire(audio);
      if (epoch !== this.#epoch) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.#stream = stream;
      this.#chunks = [];
      this.#bytes = 0;
      const audioCaptured = stream.getAudioTracks().length > 0;
      const recorder = this.create(stream);
      this.#recorder = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (epoch !== this.#epoch) return;
        this.#bytes += event.data.size;
        if (this.#bytes > MAX_VIDEO) {
          this.cancel();
          changed("Limite de 64 Mio atteinte : vidéo supprimée");
          return;
        }
        this.#chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        if (epoch !== this.#epoch) return;
        this.cancel();
        changed("Échec vidéo : pistes arrêtées");
      });
      recorder.addEventListener("stop", () => {
        if (epoch !== this.#epoch) return;
        this.release();
        if (epoch === this.#epoch)
          changed(
            "Vidéo arrêtée — préparez le dérivé assaini",
            new Blob(this.#chunks, { type: recorder.mimeType }),
            audioCaptured,
          );
        this.#chunks = [];
      });
      for (const track of stream.getVideoTracks())
        track.addEventListener("ended", () => {
          if (epoch === this.#epoch) this.stop();
        });
      recorder.start(1000);
      this.#timer = setTimeout(() => this.stop(), 60_000);
      changed("Enregistrement en cours — arrêt automatique après 60 secondes");
    } catch {
      this.cancel();
      throw new Error("Capture vidéo indisponible ou refusée");
    } finally {
      this.#pending = false;
    }
  }
  pause(): void {
    if (this.#recorder?.state !== "recording") throw new Error("Aucune vidéo active");
    this.#recorder.pause();
  }
  resume(): void {
    if (this.#recorder?.state !== "paused") throw new Error("Aucune vidéo en pause");
    this.#recorder.resume();
  }
  stop(): void {
    if (this.#recorder && this.#recorder.state !== "inactive") this.#recorder.stop();
    this.release();
  }
}
