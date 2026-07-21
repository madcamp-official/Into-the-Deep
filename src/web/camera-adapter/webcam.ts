export interface WebcamHandle {
  video: HTMLVideoElement;
  stop: () => void;
}

// Some systems have a passthrough/virtual camera device installed alongside
// other software (e.g. eye-tracking tools ship a "Mirametrix Virtual
// Camera") that Chromium's default device selection can pick over the real
// webcam. The track still reports live/unmuted — it's a real device, just
// not the one pointed at a person — so this can't be detected from track
// state, only by device label.
const VIRTUAL_CAMERA_LABEL_PATTERN = /virtual/i;

// Requests camera permission and streams into a <video> element.
// Day1 draft — resolution/facingMode constraints will be tuned once
// the reliability filter (Day2) tells us what framing it needs.
export async function startWebcam(video: HTMLVideoElement): Promise<WebcamHandle> {
  let stream = await requestStream();

  // Device labels are blank until a permission grant exists; now that the
  // request above succeeded, re-check whether we ended up on a virtual
  // camera and, if a real one is available, explicitly switch to it.
  const activeTrack = stream.getVideoTracks()[0];
  if (activeTrack && VIRTUAL_CAMERA_LABEL_PATTERN.test(activeTrack.label)) {
    console.warn(`[webcam] landed on virtual camera "${activeTrack.label}", looking for a real one`);
    const devices = await navigator.mediaDevices.enumerateDevices();
    const realCamera = devices.find(
      (device) => device.kind === "videoinput" && !VIRTUAL_CAMERA_LABEL_PATTERN.test(device.label),
    );

    if (realCamera) {
      for (const track of stream.getTracks()) track.stop();
      stream = await requestStream(realCamera.deviceId);
    }
  }

  video.srcObject = stream;
  await video.play();

  // Diagnostic-only: getUserMedia can resolve successfully (permission
  // granted, play() doesn't throw) while the underlying track never
  // delivers real frames — e.g. a capture backend issue where the track
  // stays "muted". Logged so that's visible in devtools instead of a
  // silent black/placeholder canvas.
  const [track] = stream.getVideoTracks();
  if (track) {
    console.info("[webcam] track", {
      label: track.label,
      readyState: track.readyState,
      muted: track.muted,
      settings: track.getSettings(),
    });
    track.addEventListener("mute", () => console.warn("[webcam] track muted"));
    track.addEventListener("unmute", () => console.info("[webcam] track unmuted"));
    track.addEventListener("ended", () => console.warn("[webcam] track ended"));
  }

  return {
    video,
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

function requestStream(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: 1280, height: 720 }
      : { width: 1280, height: 720, facingMode: "user" },
    audio: false,
  });
}
