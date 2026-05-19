import { Application, Text } from 'pixi.js';
import './style.css';

async function bootstrap() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('#game canvas not found');
  }

  const app = new Application();
  await app.init({
    canvas,
    width: 800,
    height: 600,
    backgroundColor: 0x1a1a1a,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const placeholder = new Text({
    text: 'mojislot-web',
    style: {
      fill: 0xffd700,
      fontSize: 48,
      fontWeight: 'bold',
    },
  });
  placeholder.anchor.set(0.5);
  placeholder.x = app.screen.width / 2;
  placeholder.y = app.screen.height / 2;
  app.stage.addChild(placeholder);
}

bootstrap().catch((err) => {
  console.error('bootstrap failed:', err);
});
