import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Aperture, ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  Contrast, Crop, Download, Expand, FlipHorizontal2, FolderOpen, Grid2X2, Image as ImageIcon,
  Maximize, Mic, MicOff, MonitorUp, MoreHorizontal, Pause, Play, Plus, RotateCcw, RotateCw,
  Settings2, SlidersHorizontal, Sparkles, SwitchCamera, TimerReset, Trash2, Video, X,
  Camera as CameraIcon, GripHorizontal, PanelsTopLeft, ShieldCheck, SunMedium, Volume2, Zap, WandSparkles,
} from 'lucide-react'
import { Analytics } from "@vercel/analytics/next"

type Page = 'camera' | 'gallery' | 'settings'
type Mode = 'PHOTO' | 'VIDEO' | 'BOOTH'
type MediaItem = { id: string; src: string; kind: 'photo' | 'video'; createdAt: string }
type Device = { deviceId: string; label: string }

const modes: Mode[] = ['PHOTO', 'VIDEO', 'BOOTH']
const effects = ['Original', 'Warm', 'Cool', 'Vintage', 'Film', 'Mono', 'Vivid'] as const
const effectFilters: Record<(typeof effects)[number], string> = {
  Original: 'brightness(1)', Warm: 'sepia(.16) saturate(1.14) contrast(1.03)', Cool: 'saturate(.9) hue-rotate(8deg)',
  Vintage: 'sepia(.3) contrast(.9) brightness(1.03)', Film: 'contrast(1.15) saturate(.82)', Mono: 'grayscale(1) contrast(1.08)', Vivid: 'saturate(1.38) contrast(1.06)',
}

function IconButton({ label, children, active, onClick, className = '' }: { label: string; children: React.ReactNode; active?: boolean; onClick?: () => void; className?: string }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''} ${className}`} onClick={onClick} aria-label={label} title={label}>{children}</button>
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordAnimationRef = useRef<number | null>(null)
  const recordStreamRef = useRef<MediaStream | null>(null)
  const initialCameraRequestRef = useRef(false)
  const [page, setPage] = useState<Page>('camera')
  const [mode, setMode] = useState<Mode>('PHOTO')
  const [collapsed, setCollapsed] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [cameraState, setCameraState] = useState<'idle' | 'active' | 'blocked' | 'missing'>('idle')
  const [grid, setGrid] = useState(true)
  const [mirror, setMirror] = useState(true)
  const [saveMirrored, setSaveMirrored] = useState(true)
  const [timer, setTimer] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [effect, setEffect] = useState<(typeof effects)[number]>('Original')
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [saturation, setSaturation] = useState(100)
  const [screenFlash, setScreenFlash] = useState(false)
  const [toast, setToast] = useState('')
  const [photos, setPhotos] = useState<MediaItem[]>([])
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordPaused, setRecordPaused] = useState(false)
  const [recordTime, setRecordTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState<3 | 5>(5)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [boothCount, setBoothCount] = useState<1 | 2 | 3 | 4>(4)
  const [boothTitle, setBoothTitle] = useState('Lumina Photo Booth')
  const [boothProgress, setBoothProgress] = useState<number | null>(null)
  const [boothPrompt, setBoothPrompt] = useState<string | null>(null)

  const announce = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const enumerateDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const cameraDevices = (await navigator.mediaDevices.enumerateDevices())
      .filter(device => device.kind === 'videoinput')
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }))
    setDevices(cameraDevices)
    if (!deviceId && cameraDevices[0]) setDeviceId(cameraDevices[0].deviceId)
  }, [deviceId])

  const startCamera = useCallback(async (requestedId = deviceId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('missing')
      return
    }
    try {
      streamRef.current?.getTracks().forEach(track => track.stop())
      const stream = await navigator.mediaDevices.getUserMedia({
        video: requestedId ? { deviceId: { exact: requestedId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraState('active')
      await enumerateDevices()
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      setCameraState(name === 'NotFoundError' ? 'missing' : 'blocked')
    }
  }, [deviceId, enumerateDevices])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    recordStreamRef.current?.getTracks().forEach(track => track.stop())
    if (recordAnimationRef.current !== null) cancelAnimationFrame(recordAnimationRef.current)
  }, [])

  // The preview element only mounts after permission has been granted. Attach an
  // already-open stream after that render as well as during initial setup.
  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (cameraState !== 'active' || !video || !stream) return
    if (video.srcObject !== stream) video.srcObject = stream
    video.play().catch(() => {
      // Some browsers wait for the next user gesture; the muted preview will
      // resume automatically when that happens.
    })
  }, [cameraState])

  useEffect(() => {
    if (initialCameraRequestRef.current) return
    initialCameraRequestRef.current = true
    void startCamera()
  }, [startCamera])

  useEffect(() => {
    if (!recording || recordPaused) return
    const interval = window.setInterval(() => setRecordTime(value => value + 1), 1000)
    return () => window.clearInterval(interval)
  }, [recording, recordPaused])

  const imageFilter = `${effectFilters[effect]} brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`

  const captureFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return null
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return null
    context.save()
    context.filter = imageFilter
    if (saveMirrored) {
      context.translate(canvas.width, 0)
      context.scale(-1, 1)
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    context.restore()
    return canvas.toDataURL('image/jpeg', .94)
  }, [imageFilter, saveMirrored])

  const saveCapture = useCallback(() => {
    const src = captureFrame()
    if (!src) return
    const item = { id: crypto.randomUUID(), src, kind: 'photo' as const, createdAt: new Date().toLocaleString([], { hour: '2-digit', minute: '2-digit' }) }
    setPhotos(current => [item, ...current])
    setScreenFlash(true)
    window.setTimeout(() => setScreenFlash(false), 170)
    announce('Photo saved')
  }, [captureFrame])

  const captureBooth = useCallback(async () => {
    if (boothProgress !== null) return
    const frames: string[] = []
    setBoothProgress(0)
    for (let shot = 0; shot < boothCount; shot += 1) {
      setBoothProgress(shot + 1)
      for (const number of ['3', '2', '1']) {
        setBoothPrompt(number)
        await new Promise(resolve => window.setTimeout(resolve, 600))
      }
      setBoothPrompt(null)
      const frame = captureFrame()
      if (frame) frames.push(frame)
      setScreenFlash(true)
      await new Promise(resolve => window.setTimeout(resolve, 170))
      setScreenFlash(false)
      await new Promise(resolve => window.setTimeout(resolve, 380))
    }
    if (frames.length) {
      const src = await createBoothStrip(frames, boothCount, boothTitle.trim() || 'Photo Booth')
      setPhotos(current => [{ id: crypto.randomUUID(), src, kind: 'photo', createdAt: new Date().toLocaleString([], { hour: '2-digit', minute: '2-digit' }) }, ...current])
      announce('Booth strip saved')
    }
    setBoothPrompt(null)
    setBoothProgress(null)
  }, [boothCount, boothProgress, boothTitle, captureFrame])

  const capture = useCallback(() => {
    if (cameraState !== 'active') return startCamera()
    if (mode === 'VIDEO') return recording ? stopRecording() : startRecording()
    if (mode === 'BOOTH') return captureBooth()
    if (timer && countdown === null) {
      setCountdown(timer)
      return
    }
    saveCapture()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, mode, recording, timer, countdown, captureBooth, saveCapture, startCamera])

  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      saveCapture()
      setCountdown(null)
      return
    }
    const timeout = window.setTimeout(() => setCountdown(value => value === null ? null : value - 1), 1000)
    return () => window.clearTimeout(timeout)
  }, [countdown, saveCapture])

  const startRecording = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!streamRef.current || !video || !canvas || typeof MediaRecorder === 'undefined') return announce('Recording is not supported in this browser')
    try {
      if (!video.videoWidth) return announce('Camera is still starting')
      chunksRef.current = []
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) return announce('Couldn’t start recording')
      const drawFrame = () => {
        context.save()
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.filter = imageFilter
        if (mirror) {
          context.translate(canvas.width, 0)
          context.scale(-1, 1)
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        context.restore()
        recordAnimationRef.current = requestAnimationFrame(drawFrame)
      }
      drawFrame()
      const recordingStream = typeof canvas.captureStream === 'function' ? canvas.captureStream(30) : streamRef.current
      recordStreamRef.current = recordingStream
      const recordingMimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type))
      const recorder = recordingMimeType ? new MediaRecorder(recordingStream, { mimeType: recordingMimeType }) : new MediaRecorder(recordingStream)
      recorderRef.current = recorder
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = () => {
        if (recordAnimationRef.current !== null) cancelAnimationFrame(recordAnimationRef.current)
        recordAnimationRef.current = null
        recordStreamRef.current?.getTracks().forEach(track => track.stop())
        recordStreamRef.current = null
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' })
        if (blob.size) setPhotos(current => [{ id: crypto.randomUUID(), src: URL.createObjectURL(blob), kind: 'video', createdAt: new Date().toLocaleString([], { hour: '2-digit', minute: '2-digit' }) }, ...current])
        setRecording(false); setRecordPaused(false); setRecordTime(0); announce('Video saved')
      }
      recorder.start(1000)
      setRecording(true); setRecordPaused(false); setRecordTime(0)
    } catch { announce('Couldn’t start recording') }
  }

  const stopRecording = () => recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop()
  useEffect(() => {
    if (!recording || recordPaused || recordTime < videoDuration) return
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [recording, recordPaused, recordTime, videoDuration])

  const togglePause = () => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording') { recorder.pause(); setRecordPaused(true) }
    else if (recorder.state === 'paused') { recorder.resume(); setRecordPaused(false) }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === 'INPUT') return
      if (event.code === 'Space') { event.preventDefault(); capture() }
      if (event.key.toLowerCase() === 'g') setGrid(value => !value)
      if (event.key.toLowerCase() === 'm') setMirror(value => !value)
      if (event.key.toLowerCase() === 't') setTimer(value => value === 3 ? 5 : value === 5 ? 10 : value === 10 ? 0 : 3)
      if (event.key.toLowerCase() === 'f') setFullscreen(value => !value)
      if (event.key === 'Escape') { setFullscreen(false); setSelected(null); setShowShortcuts(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [capture])

  const displayTime = `${String(Math.floor(recordTime / 60)).padStart(2, '0')}:${String(recordTime % 60).padStart(2, '0')}`
  const latest = photos.find(item => item.kind === 'photo') ?? photos[0]
  const setCamera = (id: string) => { setDeviceId(id); startCamera(id) }
  const enterPage = (newPage: Page) => { setPage(newPage); setSelected(null) }
  const bindPreview = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element
    if (!element || !streamRef.current) return
    element.srcObject = streamRef.current
    element.play().catch(() => undefined)
  }, [])

  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''} ${!rightOpen ? 'panel-closed' : ''} ${fullscreen ? 'immersive' : ''}`}>
    <aside className="sidebar">
      <div className="brand-row"><div className="brand-mark"><Aperture size={20} /></div><span className="brand-name">lumina</span><IconButton label="Collapse sidebar" onClick={() => setCollapsed(value => !value)} className="collapse-button"><PanelsTopLeft size={17} /></IconButton></div>
      <nav className="main-nav">
        <NavItem icon={<CameraIcon size={20} />} label="Camera" active={page === 'camera'} onClick={() => enterPage('camera')} />
        <NavItem icon={<FolderOpen size={20} />} label="Gallery" active={page === 'gallery'} badge={photos.length || undefined} onClick={() => enterPage('gallery')} />
        <NavItem icon={<Settings2 size={20} />} label="Settings" active={page === 'settings'} onClick={() => enterPage('settings')} />
      </nav>
      <div className="sidebar-footer">
        <div className="privacy-mini"><span className={`status-dot ${cameraState === 'active' ? 'live' : ''}`} /><span>Camera {cameraState === 'active' ? 'active' : 'private'}</span></div>
        <IconButton label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)}><CircleHelp size={19} /></IconButton>
      </div>
    </aside>

    <main className="main-content">
      {page === 'camera' && <CameraPage
        mode={mode} setMode={setMode} videoRef={videoRef} bindPreview={bindPreview} cameraState={cameraState} startCamera={startCamera}
        imageFilter={imageFilter} mirror={mirror} grid={grid} fullscreen={fullscreen} setFullscreen={setFullscreen}
        screenFlash={screenFlash} countdown={countdown} timer={timer} setTimer={setTimer} capture={capture} recording={recording}
        recordPaused={recordPaused} displayTime={displayTime} togglePause={togglePause} stopRecording={stopRecording} latest={latest}
        onLatest={() => latest && setSelected(latest)} devices={devices} deviceId={deviceId} setCamera={setCamera}
        rightOpen={rightOpen} setRightOpen={setRightOpen} setGrid={setGrid} setMirror={setMirror} effect={effect}
        setEffect={setEffect} setScreenFlash={() => { setScreenFlash(true); window.setTimeout(() => setScreenFlash(false), 160) }}
        boothCount={boothCount} setBoothCount={setBoothCount} boothTitle={boothTitle} setBoothTitle={setBoothTitle} boothProgress={boothProgress} boothPrompt={boothPrompt} videoDuration={videoDuration} setVideoDuration={setVideoDuration}
      />}
      {page === 'gallery' && <GalleryPage photos={photos} onOpen={setSelected} onDelete={id => setPhotos(value => value.filter(item => item.id !== id))} onCamera={() => enterPage('camera')} />}
      {page === 'settings' && <SettingsPage devices={devices} deviceId={deviceId} setCamera={setCamera} mirror={mirror} setMirror={setMirror} grid={grid} setGrid={setGrid} />}
    </main>

    {page === 'camera' && rightOpen && <SettingsPanel
      devices={devices} deviceId={deviceId} setCamera={setCamera} mirror={mirror} setMirror={setMirror} saveMirrored={saveMirrored} setSaveMirrored={setSaveMirrored}
      grid={grid} setGrid={setGrid} brightness={brightness} setBrightness={setBrightness} contrast={contrast} setContrast={setContrast}
        saturation={saturation} setSaturation={setSaturation} effect={effect} setEffect={setEffect}
        onClose={() => setRightOpen(false)} onReset={() => { setBrightness(100); setContrast(100); setSaturation(100); setEffect('Original') }}
    />}

    <nav className="mobile-nav">
      <NavItem icon={<CameraIcon size={20} />} label="Camera" active={page === 'camera'} onClick={() => enterPage('camera')} />
      <NavItem icon={<FolderOpen size={20} />} label="Gallery" active={page === 'gallery'} onClick={() => enterPage('gallery')} />
      <NavItem icon={<Settings2 size={20} />} label="Settings" active={page === 'settings'} onClick={() => enterPage('settings')} />
    </nav>

    {selected && <MediaPreview item={selected} photos={photos} onClose={() => setSelected(null)} onDelete={(id) => { setPhotos(value => value.filter(photo => photo.id !== id)); setSelected(null) }} />}
    {showShortcuts && <ShortcutModal onClose={() => setShowShortcuts(false)} />}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
    <canvas ref={canvasRef} className="hidden-canvas" />
  </div>
}

async function createBoothStrip(frames: string[], layout: 1 | 2 | 3 | 4, title: string) {
  const images = await Promise.all(frames.map(source => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })))
  const columns = layout === 4 ? 2 : 1
  const rows = layout === 4 ? 2 : layout
  const cellWidth = 720
  const cellHeight = 540
  const gutter = 26
  const labelHeight = 70
  const canvas = document.createElement('canvas')
  canvas.width = columns * cellWidth + (columns + 1) * gutter
  canvas.height = rows * cellHeight + (rows + 1) * gutter + labelHeight
  const context = canvas.getContext('2d')
  if (!context) return frames[0]
  context.fillStyle = '#f3eee5'
  context.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = gutter + column * (cellWidth + gutter)
    const y = gutter + row * (cellHeight + gutter)
    const scale = Math.max(cellWidth / image.width, cellHeight / image.height)
    const width = image.width * scale
    const height = image.height * scale
    context.save()
    context.beginPath()
    context.rect(x, y, cellWidth, cellHeight)
    context.clip()
    context.drawImage(image, x + (cellWidth - width) / 2, y + (cellHeight - height) / 2, width, height)
    context.restore()
  })
  context.fillStyle = '#27231f'
  context.font = '600 21px Manrope, Arial, sans-serif'
  context.textAlign = 'center'
  context.fillText(title.toUpperCase(), canvas.width / 2, canvas.height - 27)
  return canvas.toDataURL('image/jpeg', .94)
}

function NavItem({ icon, label, active, onClick, badge }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; badge?: number }) {
  return <button type="button" onClick={onClick} className={`nav-item ${active ? 'active' : ''}`}>{icon}<span>{label}</span>{badge ? <i>{badge}</i> : null}</button>
}

function CameraPage(props: {
  mode: Mode; setMode: (mode: Mode) => void; videoRef: React.RefObject<HTMLVideoElement | null>; bindPreview: (element: HTMLVideoElement | null) => void; cameraState: string; startCamera: () => void; imageFilter: string; mirror: boolean; grid: boolean; fullscreen: boolean; setFullscreen: (value: boolean) => void; screenFlash: boolean; countdown: number | null; timer: number; setTimer: (value: number) => void; capture: () => void; recording: boolean; recordPaused: boolean; displayTime: string; togglePause: () => void; stopRecording: () => void; latest?: MediaItem; onLatest: () => void; devices: Device[]; deviceId: string; setCamera: (id: string) => void; rightOpen: boolean; setRightOpen: (value: boolean) => void; setGrid: (value: boolean) => void; setMirror: (value: boolean) => void; effect: string; setEffect: (value: (typeof effects)[number]) => void; setScreenFlash: () => void; boothCount: 1 | 2 | 3 | 4; setBoothCount: (value: 1 | 2 | 3 | 4) => void; boothTitle: string; setBoothTitle: (value: string) => void; boothProgress: number | null; boothPrompt: string | null; videoDuration: 3 | 5; setVideoDuration: (value: 3 | 5) => void
}) {
  const { mode, setMode, videoRef, bindPreview, cameraState, startCamera, imageFilter, mirror, grid, fullscreen, setFullscreen, screenFlash, countdown, timer, setTimer, capture, recording, recordPaused, displayTime, togglePause, stopRecording, latest, onLatest, devices, deviceId, setCamera, rightOpen, setRightOpen, setGrid, setMirror, effect, setEffect, setScreenFlash, boothCount, setBoothCount, boothTitle, setBoothTitle, boothProgress, boothPrompt, videoDuration, setVideoDuration } = props
  const [toolbarOffset, setToolbarOffset] = useState({ x: 0, y: 0 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const [toolbarHidden, setToolbarHidden] = useState(false)
  useEffect(() => setToolbarHidden(fullscreen), [fullscreen])
  useEffect(() => {
    if (!dragStart) return
    const move = (event: PointerEvent) => setToolbarOffset({ x: dragStart.offsetX + event.clientX - dragStart.x, y: dragStart.offsetY + event.clientY - dragStart.y })
    const end = () => setDragStart(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
  }, [dragStart])
  const beginToolbarDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragStart({ x: event.clientX, y: event.clientY, offsetX: toolbarOffset.x, offsetY: toolbarOffset.y })
  }
  return <section className="camera-page">
    <header className="camera-header">
      <div><p className="eyebrow">CAMERA</p><h1>Capture something beautiful.</h1></div>
      <div className="header-status"><span className={`status-dot ${cameraState === 'active' ? 'live' : ''}`} />{cameraState === 'active' ? 'Camera active' : 'Camera private'}<IconButton label="Open settings" onClick={() => setRightOpen(!rightOpen)} active={rightOpen}><SlidersHorizontal size={18} /></IconButton></div>
    </header>
    <div className="mode-row"><div className="mode-selector">{modes.map(item => <button key={item} type="button" className={mode === item ? 'selected' : ''} onClick={() => setMode(item)}>{item}</button>)}</div>{mode === 'VIDEO' && <div className="duration-selector"><Clock3 size={14} /><span>Clip</span><button type="button" className={videoDuration === 3 ? 'active' : ''} disabled={recording} onClick={() => setVideoDuration(3)}>3s</button><button type="button" className={videoDuration === 5 ? 'active' : ''} disabled={recording} onClick={() => setVideoDuration(5)}>5s</button></div>}</div>
    <div className={`preview-stage ${fullscreen ? 'preview-fullscreen' : ''}`}>
      {mode !== 'BOOTH' && !toolbarHidden && <div className="preview-toolbar glass" style={{ transform: `translate(calc(-50% + ${toolbarOffset.x}px), ${toolbarOffset.y}px)` }}>
        <button type="button" className="toolbar-drag-handle" aria-label="Drag camera controls" title="Drag controls" onPointerDown={beginToolbarDrag}><GripHorizontal size={16} /></button>
        <IconButton label="Screen flash" onClick={setScreenFlash}><Zap size={17} /></IconButton>
        <div className="toolbar-divider" />
        <div className="timer-menu"><IconButton label="Timer" active={!!timer} onClick={() => setTimer(timer === 0 ? 3 : timer === 3 ? 5 : timer === 5 ? 10 : 0)}><TimerReset size={17} /></IconButton>{timer > 0 && <span>{timer}s</span>}</div>
        <IconButton label="Toggle grid" active={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={17} /></IconButton>
        <IconButton label="Mirror preview" active={mirror} onClick={() => setMirror(!mirror)}><FlipHorizontal2 size={17} /></IconButton>
        <IconButton label="Fullscreen" onClick={() => setFullscreen(!fullscreen)}><Maximize size={17} /></IconButton>
        {fullscreen && <IconButton label="Hide controls" onClick={() => setToolbarHidden(true)}><X size={17} /></IconButton>}
      </div>}
      {mode !== 'BOOTH' && fullscreen && toolbarHidden && <button type="button" className="show-toolbar-button" onClick={() => setToolbarHidden(false)}>Show controls</button>}
      {mode === 'BOOTH' && <div className="booth-guide glass"><div className="booth-guide-copy"><span>PHOTO BOOTH</span><strong>{boothProgress ? `Capturing shot ${boothProgress} of ${boothCount}` : 'Choose a layout, name it, then start the sequence.'}</strong></div><label className="booth-title"><span>STRIP LABEL</span><input value={boothTitle} maxLength={32} disabled={boothProgress !== null} onChange={event => setBoothTitle(event.target.value)} placeholder="Your name or event" /></label><div className="booth-layouts">{([1, 2, 3, 4] as const).map(count => <button key={count} type="button" className={boothCount === count ? 'active' : ''} disabled={boothProgress !== null} onClick={() => setBoothCount(count)}>{count === 1 ? 'Single' : count === 4 ? '4-grid' : `${count}-strip`}</button>)}</div></div>}
      <div className="video-frame">
        {cameraState === 'active' ? <>
          <video ref={bindPreview} autoPlay muted playsInline className={mirror ? 'mirrored' : ''} style={{ filter: imageFilter }} />
          {grid && <div className="grid-overlay" />}
          <div className="focus-box"><span /><span /><span /><span /></div>
          {screenFlash && <div className="capture-flash" />}
          {countdown !== null && <div className="countdown">{countdown || '●'}</div>}
          {boothPrompt && <div className="booth-countdown"><small>SHOT {boothProgress} OF {boothCount}</small><strong>{boothPrompt}</strong></div>}
          {recording && <div className="recording-indicator"><span className="record-dot" /> {displayTime} {recordPaused && <small>PAUSED</small>}</div>}
          <div className="preview-meta"><span>16:9</span><span>{effect}</span><span>1080p</span></div>
        </> : <PermissionScreen state={cameraState} startCamera={startCamera} />}
      </div>
      <div className="capture-strip glass">
        <button type="button" className="recent-thumb" onClick={onLatest} aria-label="Open latest photo">{latest ? latest.kind === 'video' ? <video src={latest.src} /> : <img src={latest.src} alt="Latest capture" /> : <ImageIcon size={20} />}<span /></button>
        <div className="capture-area">
          <button type="button" className={`capture-button ${mode === 'VIDEO' ? 'video-button' : ''} ${recording ? 'is-recording' : ''}`} onClick={capture} aria-label={recording ? 'Stop recording' : 'Capture'}><span /></button>
          <small>{mode === 'VIDEO' ? recording ? `${displayTime} / ${videoDuration}s` : `${videoDuration}s video` : mode === 'BOOTH' ? 'Start booth' : 'Take photo'}</small>
        </div>
        <div className="switch-wrap">{mode === 'VIDEO' && recording && <IconButton label={recordPaused ? 'Resume recording' : 'Pause recording'} onClick={togglePause}>{recordPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}</IconButton>}{devices.length > 1 && <IconButton label="Switch camera" onClick={() => setCamera(devices[(devices.findIndex(device => device.deviceId === deviceId) + 1) % devices.length].deviceId)}><SwitchCamera size={20} /></IconButton>}</div>
      </div>
      <div className="device-row"><CameraIcon size={15} /><span>Camera:</span><select value={deviceId} onChange={event => setCamera(event.target.value)} aria-label="Select camera">{devices.length ? devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>) : <option>Integrated Webcam</option>}</select><ChevronDown size={14} /></div>
    </div>
  </section>
}

function PermissionScreen({ state, startCamera }: { state: string; startCamera: () => void }) {
  const missing = state === 'missing'
  const blocked = state === 'blocked'
  const [showSteps, setShowSteps] = useState(false)
  return <div className="permission-screen"><div className="permission-icon"><CameraIcon size={30} /></div><h2>{missing ? 'No camera detected' : blocked ? 'Camera permission blocked' : 'Camera access is required'}</h2><p>{missing ? 'Connect a camera or check your browser permissions.' : blocked ? 'Allow camera access from your browser’s address bar, then try again.' : 'Your camera feed stays on this device.'}</p>{blocked && showSteps && <ol className="permission-steps"><li>Click the camera or lock icon beside the address bar.</li><li>Set <strong>Camera</strong> to <strong>Allow</strong> for this site.</li><li>Return here and select <strong>Try camera again</strong>.</li></ol>}{!missing && <button type="button" className="primary-button" onClick={startCamera}>{blocked ? 'Try camera again' : 'Enable Camera'}<ChevronRight size={17} /></button>}{blocked && <button type="button" className="text-button" onClick={() => setShowSteps(value => !value)}>{showSteps ? 'Hide permission steps' : 'Show permission steps'}</button>}{!blocked && <button type="button" className="text-button">Choose Camera Device</button>}</div>
}

function SettingsPanel({ devices, deviceId, setCamera, mirror, setMirror, saveMirrored, setSaveMirrored, grid, setGrid, brightness, setBrightness, contrast, setContrast, saturation, setSaturation, effect, setEffect, onClose, onReset }: {
  devices: Device[]; deviceId: string; setCamera: (id: string) => void; mirror: boolean; setMirror: (value: boolean) => void; saveMirrored: boolean; setSaveMirrored: (value: boolean) => void; grid: boolean; setGrid: (value: boolean) => void; brightness: number; setBrightness: (value: number) => void; contrast: number; setContrast: (value: number) => void; saturation: number; setSaturation: (value: number) => void; effect: (typeof effects)[number]; setEffect: (value: (typeof effects)[number]) => void; onClose: () => void; onReset: () => void
}) {
  return <aside className="settings-panel"><header><div><p className="eyebrow">CONTROLS</p><h2>Camera settings</h2></div><IconButton label="Close settings" onClick={onClose}><X size={19} /></IconButton></header>
    <PanelSection icon={<CameraIcon size={16} />} title="Camera" defaultOpen><label className="select-label">Device<select value={deviceId} onChange={event => setCamera(event.target.value)}>{devices.length ? devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>) : <option value="">Integrated Webcam</option>}</select></label><Toggle label="Mirror preview" checked={mirror} onChange={() => setMirror(!mirror)} /><Toggle label="Save mirrored photo" checked={saveMirrored} onChange={() => setSaveMirrored(!saveMirrored)} hint="Saves the image as you see it." /><Toggle label="Rule of thirds grid" checked={grid} onChange={() => setGrid(!grid)} /></PanelSection>
    <PanelSection icon={<SunMedium size={16} />} title="Image" defaultOpen action={<button className="reset-link" onClick={onReset}>Reset</button>}><Range label="Brightness" value={brightness} min={60} max={140} onChange={setBrightness} /><Range label="Contrast" value={contrast} min={60} max={140} onChange={setContrast} /><Range label="Saturation" value={saturation} min={0} max={160} onChange={setSaturation} /></PanelSection>
    <PanelSection icon={<Sparkles size={16} />} title="Effects" defaultOpen><div className="effects-grid">{effects.map(name => <button type="button" key={name} className={`effect-chip ${effect === name ? 'selected' : ''}`} onClick={() => setEffect(name)}><span style={{ filter: effectFilters[name] }} /><small>{name}</small></button>)}</div></PanelSection>
    <PanelSection icon={<ShieldCheck size={16} />} title="Privacy"><p className="privacy-copy">Your feed stays on your device unless you choose to download or share a capture.</p></PanelSection>
  </aside>
}

function PanelSection({ icon, title, children, defaultOpen = false, action }: { icon: React.ReactNode; title: string; children: React.ReactNode; defaultOpen?: boolean; action?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className="panel-section"><button type="button" className="section-title" onClick={() => setOpen(!open)}>{icon}<span>{title}</span>{action}<ChevronDown size={16} className={open ? 'chevron-open' : ''} /></button>{open && <div className="section-content">{children}</div>}</section>
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: () => void; hint?: string }) { return <div className="toggle-row"><div><span>{label}</span>{hint && <small>{hint}</small>}</div><button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={onChange}><i /></button></div> }
function Range({ label, value, min, max, suffix = '%', onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) { return <label className="range-row"><span>{label}</span><output>{value}{suffix}</output><input type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} /></label> }

function GalleryPage({ photos, onOpen, onDelete, onCamera }: { photos: MediaItem[]; onOpen: (item: MediaItem) => void; onDelete: (id: string) => void; onCamera: () => void }) {
  return <section className="gallery-page"><header className="standard-header"><div><p className="eyebrow">LIBRARY</p><h1>Your gallery</h1><p>Everything you capture stays right here.</p></div><div className="gallery-actions"><button type="button" className="ghost-button">Select</button><button type="button" className="primary-button" onClick={onCamera}><CameraIcon size={16} /> Open camera</button></div></header>{photos.length ? <div className="gallery-grid">{photos.map((item, index) => <article className={`gallery-card item-${index % 5}`} key={item.id}><button type="button" onClick={() => onOpen(item)}>{item.kind === 'video' ? <video src={item.src} muted /> : <img src={item.src} alt={`Capture from ${item.createdAt}`} />}<span className="media-kind">{item.kind === 'video' ? <Video size={14} /> : <ImageIcon size={14} />}</span></button><footer><span>{item.createdAt}</span><IconButton label="Delete capture" onClick={() => onDelete(item.id)}><Trash2 size={15} /></IconButton></footer></article>)}</div> : <div className="empty-gallery"><div className="empty-icon"><ImageIcon size={28} /></div><h2>No photos yet</h2><p>Photos and videos you capture will appear here.</p><button type="button" className="primary-button" onClick={onCamera}>Capture your first photo</button></div>}</section>
}

function MediaPreview({ item, photos, onClose, onDelete }: { item: MediaItem; photos: MediaItem[]; onClose: () => void; onDelete: (id: string) => void }) {
  const [index, setIndex] = useState(Math.max(0, photos.findIndex(photo => photo.id === item.id)))
  const activeItem = photos[index] ?? item
  const changePhoto = (direction: number) => {
    setIndex(current => (current + direction + photos.length) % photos.length)
  }
  const download = () => { const link = document.createElement('a'); link.href = activeItem.src; link.download = `lumina-${activeItem.id}.${activeItem.kind === 'video' ? 'webm' : 'jpg'}`; link.click() }
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && photos.length > 1) changePhoto(-1)
      if (event.key === 'ArrowRight' && photos.length > 1) changePhoto(1)
    }
    window.addEventListener('keydown', navigate)
    return () => window.removeEventListener('keydown', navigate)
  }, [photos.length])
  return <div className="preview-modal" role="dialog" aria-modal="true"><header><button type="button" className="back-button" onClick={onClose}><X size={20} /> Close</button><span>{index + 1} of {photos.length}</span><div><IconButton label="Download" onClick={download}><Download size={19} /></IconButton><IconButton label="Delete" onClick={() => onDelete(activeItem.id)}><Trash2 size={19} /></IconButton></div></header><div className="preview-image-wrap">{photos.length > 1 && <div className="preview-navigation"><button type="button" className="media-arrow" onClick={() => changePhoto(-1)} aria-label="Previous capture"><ChevronLeft size={23} /></button><button type="button" className="media-arrow" onClick={() => changePhoto(1)} aria-label="Next capture"><ChevronRight size={23} /></button></div>}{activeItem.kind === 'video' ? <video src={activeItem.src} controls autoPlay /> : <div className="preview-photo"><img src={activeItem.src} alt="Captured media" /></div>}</div></div>
}

function EditorPage({ item, onBack }: { item?: MediaItem; onBack: () => void }) {
  const [rotation, setRotation] = useState(0); const [brightness, setBrightness] = useState(100); const [filter, setFilter] = useState<(typeof effects)[number]>('Original')
  if (!item) return <section className="empty-page"><div className="empty-icon"><WandSparkles size={28} /></div><h1>Editor is ready</h1><p>Capture a photo first, then make it your own.</p><button className="primary-button" onClick={onBack}>Go to gallery</button></section>
  return <section className="editor-page"><header className="editor-header"><button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Gallery</button><div><p className="eyebrow">PHOTO EDITOR</p><h1>Fine tune your shot.</h1></div><div><button className="ghost-button">Reset</button><button className="primary-button">Save copy</button></div></header><div className="editor-workspace"><div className="editor-canvas">{item.kind === 'video' ? <video src={item.src} controls /> : <img src={item.src} alt="Editing" style={{ transform: `rotate(${rotation}deg)`, filter: `${effectFilters[filter]} brightness(${brightness}%)` }} />}</div><aside className="editor-panel"><PanelSection title="Crop & rotate" icon={<Crop size={16} />} defaultOpen><div className="tool-row"><button onClick={() => setRotation(rotation - 90)}><RotateCcw size={16} /> -90°</button><button onClick={() => setRotation(rotation + 90)}><RotateCw size={16} /> +90°</button></div></PanelSection><PanelSection title="Adjust" icon={<SlidersHorizontal size={16} />} defaultOpen><Range label="Brightness" value={brightness} min={60} max={140} onChange={setBrightness} /><Range label="Highlights" value={54} min={0} max={100} onChange={() => undefined} /><Range label="Shadows" value={42} min={0} max={100} onChange={() => undefined} /></PanelSection><PanelSection title="Filters" icon={<Sparkles size={16} />} defaultOpen><div className="editor-filters">{effects.map(value => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div></PanelSection></aside></div></section>
}

function SettingsPage({ devices, deviceId, setCamera, mirror, setMirror, grid, setGrid }: { devices: Device[]; deviceId: string; setCamera: (id: string) => void; mirror: boolean; setMirror: (value: boolean) => void; grid: boolean; setGrid: (value: boolean) => void }) {
  return <section className="settings-page"><header className="standard-header"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1><p>Only controls that affect your camera are shown here.</p></div></header><div className="settings-layout"><section className="settings-list"><SettingsCard title="Camera" description="Choose the active camera for future captures"><label className="select-label">Camera device<select value={deviceId} onChange={event => setCamera(event.target.value)}>{devices.length ? devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>) : <option>Integrated Webcam</option>}</select></label></SettingsCard><SettingsCard title="Preview" description="These settings apply immediately"><Toggle label="Mirror preview" checked={mirror} onChange={() => setMirror(!mirror)} /><Toggle label="Rule of thirds grid" checked={grid} onChange={() => setGrid(!grid)} /></SettingsCard></section><aside className="privacy-card"><ShieldCheck size={22} /><h2>Private by default</h2><p>Your live camera feed never leaves your device unless you download a capture.</p></aside></div></section>
}

function SettingsCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <article className="settings-card"><header><h2>{title}</h2><p>{description}</p></header>{children}</article> }

function ShortcutModal({ onClose }: { onClose: () => void }) { const rows = [['Space', 'Take photo / start recording'], ['G', 'Toggle grid'], ['M', 'Toggle mirror preview'], ['T', 'Cycle timer'], ['F', 'Toggle fullscreen'], ['Esc', 'Close or exit fullscreen']]; return <div className="shortcut-backdrop" onMouseDown={onClose}><div className="shortcut-modal" onMouseDown={event => event.stopPropagation()}><header><div><p className="eyebrow">KEYBOARD</p><h2>Quick shortcuts</h2></div><IconButton label="Close" onClick={onClose}><X size={19} /></IconButton></header>{rows.map(([key, description]) => <div className="shortcut-row" key={key}><kbd>{key}</kbd><span>{description}</span></div>)}</div></div> }

export default App
