import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowLeft, ArrowRight, X, Grid2X2, RotateCcw, MoveHorizontal, Play, Pause, Copy, Check, Volume2 } from 'lucide-react';
import { projects, profile } from './data/projects';
import MuseumMap from './MuseumMap';
const Gallery=lazy(()=>import('./Gallery'));
function projectFromURL(){const id=location.hash.match(/^#\/project\/([^/]+)$/)?.[1];return projects.some(p=>p.id===id)?id!:null;}
function useMedia(query:string){const [matches,set]=useState(()=>matchMedia(query).matches);useEffect(()=>{const media=matchMedia(query),update=()=>set(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[query]);return matches;}
function hasWebGL(){try{const canvas=document.createElement('canvas');const gl=canvas.getContext('webgl2');if(gl){gl.getExtension('WEBGL_lose_context')?.loseContext();return true;}}catch{/* Static gallery remains available. */}return false;}

export default function App(){
  const [selected,setSelected]=useState<string|null>(projectFromURL);
  const [mediaIndex,setMediaIndex]=useState(0),[playing,setPlaying]=useState(false),[mediaError,setMediaError]=useState(false),[retry,setRetry]=useState(0);
  const [ready,setReady]=useState(false),[flat,setFlat]=useState(()=>new URLSearchParams(location.search).get('view')==='flat'||!hasWebGL());
  const [sceneKey,setSceneKey]=useState(0),[reset,setReset]=useState(0),[copied,setCopied]=useState(false);
  const [sheet,setSheet]=useState<'about'|'index'|null>(null);
  const mobile=useMedia('(max-width: 899px)'),reduced=useMedia('(prefers-reduced-motion: reduce)');
  const dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null),lastSelected=useRef<string|null>(null);
  const activeIndex=projects.findIndex(p=>p.id===selected),project=projects[activeIndex],media=project?.media[mediaIndex];
  const open=useCallback((id:string|null)=>{setSheet(null);if(id===projectFromURL())return;history.pushState(null,'',`${location.pathname}${location.search}${id?`#/project/${id}`:''}`);setSelected(id);document.body.style.cursor='';},[]);
  const step=useCallback((delta:number)=>{const current=projects.findIndex(p=>p.id===selected);open(projects[(current+delta+projects.length)%projects.length].id);},[selected,open]);
  const onReady=useCallback(()=>setReady(true),[]),onFailure=useCallback(()=>setFlat(true),[]),onVideoEnd=useCallback(()=>setPlaying(false),[]);
  useEffect(()=>{const changed=()=>setSelected(projectFromURL());window.addEventListener('popstate',changed);window.addEventListener('hashchange',changed);return()=>{window.removeEventListener('popstate',changed);window.removeEventListener('hashchange',changed);};},[]);
  useEffect(()=>{setMediaIndex(0);setPlaying(false);setMediaError(false);setCopied(false);document.title=selected?`${projects.find(p=>p.id===selected)?.title} — STILL`:'STILL — A space for ideas';
    if(selected){lastSelected.current=selected;requestAnimationFrame(()=>heading.current?.focus({preventScroll:true}));}
    else if(lastSelected.current){requestAnimationFrame(()=>document.getElementById(`project-${lastSelected.current}`)?.focus({preventScroll:true}));}
  },[selected]);
  useEffect(()=>{setPlaying(false);setMediaError(false);},[mediaIndex]);
  useEffect(()=>{const d=dialog.current;if(sheet&&!d?.open)d?.showModal();else if(!sheet&&d?.open)d.close();},[sheet]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(sheet||!selected||(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]'))return;
    if(e.key==='Escape'){e.preventDefault();open(null);}if(e.key==='ArrowLeft'){e.preventDefault();step(-1);}if(e.key==='ArrowRight'){e.preventDefault();step(1);}
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[selected,step,open,sheet]);
  const share=async()=>{try{await navigator.clipboard.writeText(location.href);setCopied(true);}catch{setCopied(false);}};
  const retryScene=async()=>{const gallery=await import('./Gallery');gallery.clearGalleryCache();setReady(false);setSceneKey(k=>k+1);setFlat(false);};
  return <main className={`${selected?'is-detail':''} ${flat?'is-flat':''}`}>
    <a className="skip-link" href={selected?'#project-title':'#project-navigation'}>{selected?'작품 설명으로 이동':'작품 목록으로 이동'}</a>
    <div className="gallery-viewport" aria-label={selected?`${project.title} 작품 미리보기`:'3D 포트폴리오 전시장'}>
      {flat?<div className="flat-scene" style={{backgroundImage:'url(/gallery-poster.webp)'}}>{selected?<div className="flat-art">{media?.type==='video'?<video key={media.src} src={media.src} controls playsInline onError={()=>setMediaError(true)}/>:<img key={`${media?.src}-${retry}`} src={media?.src} alt={media?.alt} onError={()=>setMediaError(true)}/>}</div>:null}</div>:
      <Suspense fallback={null}><Gallery key={sceneKey} selected={selected} mediaIndex={mediaIndex} playing={playing} retry={retry} reduced={reduced} mobile={mobile} reset={reset} onSelect={open} onReady={onReady} onMediaError={setMediaError} onVideoEnd={onVideoEnd} onFailure={onFailure}/></Suspense>}
      {!ready&&!flat?<div className="loading" role="status"><span className="loading-mark">s.</span><p>전시장의 빛을 불러오는 중</p><button onClick={()=>setFlat(true)}>이미지로 먼저 둘러보기 <ArrowUpRight size={14}/></button></div>:null}
      {selected?<div className="preview-label"><span className="tiny-dot"/> IN THE MUSEUM <span className="preview-number">{String(activeIndex+1).padStart(2,'0')} / 08</span></div>:null}
      {selected?<div className="media-bar" aria-label="작품 미리보기 조작">
        {media?.type==='video'&&!flat?<button className="round small" aria-label={playing?'영상 일시 정지':'영상 재생'} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={15}/>:<Play size={15}/>}</button>:null}
        <div className="media-dots">{project.media.map((m,i)=><button key={m.src} className={i===mediaIndex?'active':''} aria-label={`${i+1}번 ${m.type==='video'?'영상':'이미지'} 보기`} aria-pressed={i===mediaIndex} onClick={()=>setMediaIndex(i)}>{m.type==='video'?<Play size={11}/>:<span/>}</button>)}</div>
        <span className="media-count">{String(mediaIndex+1).padStart(2,'0')} / {String(project.media.length).padStart(2,'0')}</span>
        {media?.type==='video'?<Volume2 size={13} aria-label="샘플 영상에는 소리가 없습니다"/>:null}
      </div>:null}
      {mediaError?<div className="media-error" role="alert">미디어를 불러오지 못했습니다.<button onClick={()=>setRetry(n=>n+1)}>다시 불러오기 <RotateCcw size={13}/></button></div>:null}
    </div>
    <header className="site-header">
      <button className="wordmark" aria-label="STILL 전체 전시 보기" onClick={()=>{open(null);setReset(n=>n+1);}}>still<span>.</span></button>
      <div className="header-caption">INDEPENDENT DESIGNER<br/><span>SELECTED WORKS · 2026</span></div>
      <nav aria-label="메인 메뉴"><button className="index-button" onClick={()=>setSheet('index')}><Grid2X2 size={14}/><span>프로젝트</span><sup>08</sup></button><button onClick={()=>setSheet('about')}>소개 · 연락 <ArrowUpRight size={14}/></button></nav>
    </header>
    {!selected?<>
      <div className="edition"><span className="tiny-dot"/> EIGHT ROOMS, ONE COURTYARD <span>LIGHT COURT · 14M</span></div>
      <section className="intro"><p className="eyebrow">A PERSONAL ARCHIVE</p><h1>Ideas, <br/><em>given space.</em></h1><p className="intro-caption">{profile.tagline} <span>작품을 선택해 이야기를 만나보세요.</span></p></section>
      <div className="view-tools"><span><MoveHorizontal size={15}/> 드래그하여 둘러보기</span><button className="round" onClick={()=>setReset(n=>n+1)} aria-label="처음 관람 위치로 돌아가기"><RotateCcw size={16}/></button></div>
      <nav className="project-rail" id="project-navigation" aria-label="전시된 프로젝트">
        <div className="rail-title">THE COLLECTION <span>선택한 작업들</span></div>
        <div className="rail-items">{projects.map((p,i)=><button id={`project-${p.id}`} className="project-tile" key={p.id} onClick={()=>open(p.id)} aria-label={`${String(i+1).padStart(2,'0')} ${p.title} 프로젝트 열기`}><img src={`/art/${p.id}-thumb.webp`} alt="" width="34" height="45"/><span><small>{String(i+1).padStart(2,'0')}</small><strong>{p.title}</strong></span><ArrowUpRight size={13}/></button>)}</div>
      </nav>
      <footer className="site-footer"><span>© 2026 STILL</span><span>가상 전시 · 모든 프로젝트는 샘플입니다</span><button onClick={()=>flat?retryScene():setFlat(true)}>{flat?'3D로 보기':'이미지로 보기'}</button></footer>
    </>:<>
      <button className="back-to-gallery" onClick={()=>open(null)}><ArrowLeft size={15}/> 전체 전시</button>
      <aside className="project-panel" aria-labelledby="project-title" key={project.id}>
        <div className="panel-toolbar"><span>PROJECT {String(activeIndex+1).padStart(2,'0')} <span>/ 08</span></span><button className="round small" onClick={()=>open(null)} aria-label="작품 설명 닫기"><X size={18}/></button></div>
        <div className="panel-scroll">
          <div className="project-meta"><span>{project.category}</span><span>{project.year}</span></div>
          <h2 id="project-title" ref={heading} tabIndex={-1}>{project.title}</h2><p className="project-subtitle">{project.subtitle}</p>
          <span className="sample-label">SAMPLE PROJECT</span><p className="summary">{project.summary}</p>
          <dl className="project-facts"><div><dt>ROLE</dt><dd>{project.role}</dd></div><div><dt>PERIOD</dt><dd>{project.period}</dd></div></dl>
          <section className="story"><h3><span>01</span> 작업의 시작</h3><p>{project.purpose}</p></section>
          <section className="story"><h3><span>02</span> 과정과 탐구</h3><p>{project.process}</p></section>
          <section className="story"><h3><span>03</span> 결과</h3><p>{project.outcome}</p></section>
          {project.links.length?<div className="project-links">{project.links.map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}<ArrowUpRight size={15}/></a>)}</div>:null}
          <button className="share-button" onClick={share}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'작품 주소를 복사했습니다':'이 작품의 주소 복사'}</button>
          <p className="sample-note">전시 구성을 위한 가상 프로젝트입니다.<br/>실제 작업 자료로 교체할 수 있습니다.</p>
        </div>
        <nav className="project-pagination" aria-label="작품 간 이동"><button onClick={()=>step(-1)}><ArrowLeft size={17}/><span>이전 작품</span></button><span>{String(activeIndex+1).padStart(2,'0')} — 08</span><button onClick={()=>step(1)}><span>다음 작품</span><ArrowRight size={17}/></button></nav>
      </aside>
    </>}
    {flat?<div className="flat-notice">이미지 관람 모드 <button onClick={retryScene}>3D 다시 시도</button></div>:null}
    <span className="sr-only" role="status">{selected?`${project.title}, ${activeIndex+1}번째 작품. 좌우 방향키로 작품 이동, Escape로 닫기.`:'전체 전시를 보고 있습니다.'}</span>
    <dialog ref={dialog} className="info-dialog" aria-label={sheet==='index'?'프로젝트 목록':'전시 소개와 연락처'} onCancel={()=>setSheet(null)} onClose={()=>setSheet(null)}>
      <div className="dialog-header"><span>{sheet==='index'?'THE COLLECTION':'ABOUT THIS SPACE'}</span><button className="round small" onClick={()=>setSheet(null)} aria-label="창 닫기"><X size={19}/></button></div>
      {sheet==='index'?<><h2>Selected works<span>08</span></h2><MuseumMap onSelect={open}/><div className="index-list">{projects.map((p,i)=><button key={p.id} onClick={()=>open(p.id)}><span>{String(i+1).padStart(2,'0')}</span><img src={`/art/${p.id}-thumb.webp`} alt=""/><span><strong>{p.title}</strong><small>{p.category}</small></span><ArrowUpRight size={20}/></button>)}</div></>:<><p className="eyebrow">A SPACE FOR IDEAS</p><h2>조금 더 오래,<br/><em>머무는 작업.</em></h2><p>{profile.description}</p><p>{profile.about}</p><div className="contact-block"><span>LET’S MAKE SOMETHING.</span>{profile.email?<a href={`mailto:${profile.email}`}>{profile.email} <ArrowUpRight size={18}/></a>:<p>연락처 준비 중 <small>실제 소개와 이메일을 넣을 자리입니다.</small></p>}</div><p className="dialog-help">작품을 클릭하거나 목록에서 선택하세요.<br/>작품을 연 뒤 ← → 키로 이동하고 Esc로 돌아올 수 있습니다.</p></>}
    </dialog>
  </main>;
}

