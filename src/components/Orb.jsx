// ElevenLabs-style colour sphere, tinted with the voice's own colour.
export default function Orb({ color = '#b855e7', size, warm, cool }) {
  const style = { '--c': color };
  if (size) style['--size'] = `${size}px`;
  if (warm) style['--warm'] = warm;
  if (cool) style['--cool'] = cool;
  return <span className="orb" style={style} aria-hidden="true" />;
}
