import { Icon } from './Icon';

export function OrbitScene({ variant = 'hero' }: { variant?: 'hero' | 'auth' }) {
  return <div className={`orbit-scene orbit-scene--${variant}`} aria-hidden="true">
    <div className="scene-glow" />
    <div className="scene-orbit scene-orbit--one" /><div className="scene-orbit scene-orbit--two" />
    <div className="scene-dot scene-dot--one" /><div className="scene-dot scene-dot--two" />
    <div className="scene-book-float"><div className="scene-book">
      <div className="book-face book-face--front"><Icon name="spark" size={24} /><span>keep<br />learning.</span><i /></div>
      <div className="book-face book-face--back" /><div className="book-spine" /><div className="book-pages" /><div className="book-top" /><div className="book-bottom" />
    </div></div>
    <div className="scene-paper"><Icon name="note" size={19} /><i /><i /><i /><span>one good idea</span></div>
    <div className="scene-chip"><span><Icon name="check" size={15} /></span><i /><i /></div>
    <span className="scene-star scene-star--one">✧</span><span className="scene-star scene-star--two">✧</span>
  </div>;
}

export function AmbientBackground() {
  return <div className="ambient-background" aria-hidden="true"><div /><div /><div /></div>;
}
