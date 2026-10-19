import { useEffect, useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import './gallery-loading.css';

export type LoadingStage = 'space' | 'lighting' | 'finishing';
const stages: { id: LoadingStage; label: string; message: string }[] = [
  { id: 'space', label: '공간', message: '네 개의 전시실을 불러오고 있어요' },
  { id: 'lighting', label: '빛과 작품', message: '전시장의 빛과 작품을 준비하고 있어요' },
  { id: 'finishing', label: '입장 준비', message: '마지막으로 공간을 다듬고 있어요' },
];

export default function GalleryLoading({ ready, stage, reduced, onSkip }: {
  ready: boolean; stage: LoadingStage; reduced: boolean; onSkip: () => void;
}) {
  const [visible, setVisible] = useState(!ready);
  const current = ready ? stages.length : stages.findIndex(item => item.id === stage);
  useEffect(() => {
    if (!ready) { setVisible(true); return; }
    // Only fade the cover after the real first frame; never hold up scene preparation.
    if (reduced) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(false), 360);
    return () => clearTimeout(timer);
  }, [ready, reduced]);
  if (!visible) return null;
  return <section className={`gallery-loading${ready ? ' gallery-loading--complete' : ''}`}
    aria-label="전시장 로딩" aria-hidden={ready} inert={ready} data-testid="gallery-loading" data-stage={ready ? 'ready' : stage}>
    <div className="gallery-loading__content">
      <p className="gallery-loading__eyebrow">A SPACE FOR IDEAS</p>
      <div className="gallery-loading__portal" aria-hidden="true">
        <svg viewBox="0 0 240 200" fill="none">
          <path className="portal-base" d="M16 184H224"/>
          {[0, 1, 2, 3].map(i => <path key={i} className={`portal-arch portal-arch--${i}`}
            d={`M${34 + i * 16} 184V${99 + i * 8}a${86 - i * 16} ${86 - i * 16} 0 0 1 ${172 - i * 32} 0V184`}/>)
          }
        </svg>
        <span className="gallery-loading__mark">s<span>.</span></span>
        <span className="gallery-loading__light"/>
      </div>
      <h1 className="gallery-loading__title">A moment before<br/><em>you step inside.</em></h1>
      <p className="gallery-loading__message" role="status" aria-live="polite" aria-atomic="true">
        {ready ? '전시장이 준비되었습니다' : stages[current].message}
      </p>
      <div className="gallery-loading__progress" role="progressbar" aria-label="전시장 준비 상태"
        aria-valuetext={ready ? '준비 완료' : stages[current].message}>
        <span/>
      </div>
      <ol className="gallery-loading__steps" aria-label="전시장 준비 단계">
        {stages.map((item, index) => <li key={item.id} className={index < current ? 'is-done' : index === current ? 'is-current' : ''}
          aria-current={index === current ? 'step' : undefined}>
          <span className="gallery-loading__step-icon" aria-hidden="true">{index < current ? <Check size={10}/> : `0${index + 1}`}</span>{item.label}
          <span className="sr-only">{index < current ? ' 완료' : index === current ? ' 준비 중' : ' 대기'}</span>
        </li>)}
      </ol>
      <button className="gallery-loading__skip" onClick={onSkip}>이미지로 먼저 둘러보기 <ArrowUpRight size={13}/></button>
    </div>
    <p className="gallery-loading__caption">FOUR ROOMS <span>·</span> ONE OPEN HALL</p>
  </section>;
}
