
import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  active: boolean;
  color?: string;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser, active, color = '#10b981' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !analyser || !active) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = color;
        // Usamos fillRect para máxima compatibilidad
        ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth, barHeight);
        x += barWidth + 2;
      }
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [analyser, active, color]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full" 
      width={400} 
      height={100}
    />
  );
};

export default AudioVisualizer;
