export interface WebcamHandle {
  video: HTMLVideoElement;
  stop: () => void;
}

// Requests camera permission and streams into a <video> element.
// Day1 draft — resolution/facingMode constraints will be tuned once
// the reliability filter (Day2) tells us what framing it needs.
export async function startWebcam(video: HTMLVideoElement): Promise<WebcamHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: "user" },
    audio: false,
  });

  video.srcObject = stream;
  await video.play();

  return {
    video,
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
    },
  };
}
