import { faceFor } from '../lib/faces';
import Orb from './Orb';

// Character portrait when we have one, colour orb otherwise (effects, custom chain).
export default function Avatar({ voice, size = 30 }) {
  const src = voice ? faceFor(voice.id) : null;
  if (!src) return <Orb color={voice?.color || '#555'} size={size} />;
  return <img className="avatar" src={src} alt="" width={size} height={size} style={{ '--c': voice.color }} />;
}
