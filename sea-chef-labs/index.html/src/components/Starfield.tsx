import { useEffect, useRef } from 'react';

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const stars: { x: number; y: number; z: number; size: number; color: string }[] = [];
    const nebulae: { x: number; y: number; radius: number; color: string; phase: number }[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Create stars
    for (let i = 0; i < 200; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 3,
        size: Math.random() * 1.5 + 0.5,
        color: ['#a78bfa', '#67e8f9', '#f0abfc', '#ffffff', '#c4b5fd'][Math.floor(Math.random() * 5)],
      });
    }

    // Create nebula clouds
    for (let i = 0; i < 5; i++) {
      nebulae.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 200 + 100,
        color: ['rgba(139,92,246,0.03)', 'rgba(6,182,212,0.03)', 'rgba(236,72,153,0.02)', 'rgba(99,102,241,0.03)'][Math.floor(Math.random() * 4)],
        phase: Math.random() * Math.PI * 2,
      });
    }

    let time = 0;
    const animate = () => {
      time += 0.005;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw nebulae
      nebulae.forEach(n => {
        const gradient = ctx.createRadialGradient(
          n.x + Math.sin(time + n.phase) * 20,
          n.y + Math.cos(time + n.phase) * 20,
          0,
          n.x, n.y, n.radius
        );
        gradient.addColorStop(0, n.color);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      });

      // Draw stars
      stars.forEach(star => {
        const twinkle = Math.sin(time * 2 + star.x * 0.01) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size * (0.5 + twinkle * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = star.color;
        ctx.globalAlpha = 0.3 + twinkle * 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Slow drift
        star.y -= star.z * 0.05;
        if (star.y < -5) {
          star.y = canvas.height + 5;
          star.x = Math.random() * canvas.width;
        }
      });

      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
    />
  );
}
