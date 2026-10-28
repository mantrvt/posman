import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check, Sun, Moon, Upload, Download, X, File, FileText, Image, Video, PackageOpen, AlertTriangle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import JSZip from 'jszip';
import { SpeedInsights } from "@vercel/speed-insights/react";

export default function Posman() {
  const [roomCode, setRoomCode] = useState('');
  const [peerId, setPeerId] = useState('');
  const [remoteRoomCode, setRemoteRoomCode] = useState('');
  const [connected, setConnected] = useState(false);
  const [files, setFiles] = useState([]);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [receivingProgress, setReceivingProgress] = useState({}); 
  const [status, setStatus] = useState('Ready');
  const [warning, setWarning] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [mode, setMode] = useState('files');
  const [textDraft, setTextDraft] = useState('');
  const [sentTexts, setSentTexts] = useState([]);
  const [receivedTexts, setReceivedTexts] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('posman-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('posman-theme', theme);
  }, [theme]);
  
  const peerRef = useRef(null);
  const connectionRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);
  const pingIntervalRef = useRef(null);
  
  const incomingFilesRef = useRef({});

  const generateRoomCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const startHeartbeat = (conn) => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    pingIntervalRef.current = setInterval(() => {
      if (conn.open) {
        conn.send({ type: 'ping' });
      }
    }, 10000); 
  };

  const stopHeartbeat = () => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
  };

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/peerjs@1.5.1/dist/peerjs.min.js';
    script.integrity = 'sha384-qOF1Ybxd53PR4BTaDzAk+eXLDARxOKQYQpXPqbJu/xkJWLIDDfP/ZusfTctQyNs+';
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => {
      const code = generateRoomCode();
      const peer = new window.Peer(code); 
      
      peer.on('open', (id) => {
        setPeerId(id); 
        setRoomCode(id);
        setStatus('Ready to share');
      });

      peer.on('connection', (conn) => {
        connectionRef.current = conn;
        
        conn.on('open', () => {
          setConnected(true);
          setStatus('Connected!');
          startHeartbeat(conn);
        });
        
        conn.on('data', handleIncomingData);

        conn.on('close', () => {
          setConnected(false);
          setStatus('Connection closed');
          stopHeartbeat();
        });
      });

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          setStatus('Code taken, refreshing...');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          console.error('Peer error:', err);
        }
      });

      peerRef.current = peer;
    };
    
    document.head.appendChild(script);

    return () => {
      if (peerRef.current) peerRef.current.destroy();
      stopHeartbeat();
    };
  }, []);

  const connectToRoom = async () => {
    if (!remoteRoomCode || remoteRoomCode.length !== 6) {
      setStatus('Please enter a 6-digit room code');
      return;
    }

    setStatus('Connecting...');
    const conn = peerRef.current.connect(remoteRoomCode);
    
    conn.on('open', () => {
      connectionRef.current = conn;
      setConnected(true);
      setStatus('Connected!');
      startHeartbeat(conn);
    });

    conn.on('data', handleIncomingData);

    conn.on('close', () => {
      setConnected(false);
      setStatus('Connection closed');
      stopHeartbeat();
    });

    conn.on('error', (err) => {
      setStatus('Could not connect - check the room code');
      stopHeartbeat();
    });
  };

  const handleIncomingData = async (data) => {
    if (data.type === 'ping') return;

    if (data.type === 'text') {
      const text = String(data.text ?? '').slice(0, 100000);
      setReceivedTexts(prev => [{ id: Date.now() + Math.random(), text, at: new Date() }, ...prev]);
      setMode('text');
      setStatus('Text received');
      return;
    }

    if (data.fileName) {
      data.fileName = data.fileName.split(/[\\/]/).pop().replace(/\.\./g, '');
    }

    if (data.type === 'file-start') {
      incomingFilesRef.current[data.fileName] = {
        chunks: [],
        type: data.fileType,
        size: data.fileSize,
        receivedBytes: 0,
        lastReportedProgress: 0
      };
      
      setReceivingProgress(prev => ({
        ...prev,
        [data.fileName]: { size: data.fileSize, type: data.fileType, progress: 0 }
      }));
      
      setStatus(`Receiving: ${data.fileName}...`);
      
    } else if (data.type === 'file-chunk') {
      const fileTracker = incomingFilesRef.current[data.fileName];
      if (fileTracker) {
        fileTracker.chunks.push(data.chunk);
        fileTracker.receivedBytes += data.chunk.byteLength;
        
        const currentProgress = Math.min(100, Math.round((fileTracker.receivedBytes / fileTracker.size) * 100));
        if (currentProgress >= fileTracker.lastReportedProgress + 5) {
          fileTracker.lastReportedProgress = currentProgress;
          setReceivingProgress(prev => ({
            ...prev,
            [data.fileName]: { ...prev[data.fileName], progress: currentProgress }
          }));
        }
      }
    } else if (data.type === 'file-end') {
      const fileTracker = incomingFilesRef.current[data.fileName];
      if (fileTracker) {
        const blob = new Blob(fileTracker.chunks, { type: fileTracker.type });
        const url = URL.createObjectURL(blob);
        
        setReceivedFiles(prev => [...prev, {
          id: Date.now() + Math.random(),
          name: data.fileName,
          size: fileTracker.size,
          url: url,
          blob: blob, 
          type: fileTracker.type
        }]);
        
        delete incomingFilesRef.current[data.fileName];
        
        setReceivingProgress(prev => {
          const copy = { ...prev };
          delete copy[data.fileName];
          return copy;
        });
        
        setStatus(`✅ Got: ${data.fileName}`);
      }
    } else if (data.type === 'batch-start') {
      setStatus(`Receiving ${data.fileCount} file(s)...`);
    } else if (data.type === 'batch-complete') {
      setStatus('All files received!');
    }
  };

  const removeReceivedFile = (fileId, fileUrl) => {
    setReceivedFiles(prev => prev.filter(f => f.id !== fileId));
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
    }
  };

  const sendSingleFile = async (fileObj, index) => {
    return new Promise(async (resolve) => {
      try {
        const file = fileObj.file;
        const CHUNK_SIZE = 256 * 1024;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        
        connectionRef.current.send({
          type: 'file-start',
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          totalChunks: totalChunks
        });

        let offset = 0;
        let chunkCount = 0;
        let lastReportedProgress = 0;

        while (offset < file.size) {
          const dc = connectionRef.current?.dataChannel;
          if (dc && dc.bufferedAmount > 8 * 1024 * 1024) {
            await new Promise(r => setTimeout(r, 10)); 
          } else if (chunkCount % 10 === 0) {
            await new Promise(r => setTimeout(r, 0));
          }

          const chunk = file.slice(offset, offset + CHUNK_SIZE);
          const buffer = await chunk.arrayBuffer();

          connectionRef.current.send({
            type: 'file-chunk',
            fileName: file.name,
            chunk: buffer
          });

          offset += CHUNK_SIZE;
          chunkCount++;

          const currentProgress = Math.min(100, Math.round((offset / file.size) * 100));
          if (currentProgress >= lastReportedProgress + 5 || offset >= file.size) {
            lastReportedProgress = currentProgress;
            setFiles(prev => prev.map((f, idx) => 
              idx === index ? { ...f, progress: currentProgress } : f
            ));
          }
        }

        connectionRef.current.send({
          type: 'file-end',
          fileName: file.name
        });

        setTimeout(() => resolve(), 20);

      } catch (error) {
        console.error("Transfer failed:", error);
        resolve();
      }
    });
  };

  const sendFiles = async () => {
    if (files.length === 0 || !connectionRef.current) {
      setStatus('No files to send');
      return;
    }

    setStatus(`Sending ${files.length} file(s)...`);
    connectionRef.current.send({ type: 'batch-start', fileCount: files.length });

    for (let i = 0; i < files.length; i++) {
      await sendSingleFile(files[i], i);
    }

    connectionRef.current.send({ type: 'batch-complete' });
    setStatus('All sent!');
    setFiles([]);
    setWarning('');
  };

  const addFiles = (newFiles) => {
    const ONE_HUNDRED_MB = 100 * 1024 * 1024;
    const hasLargeFile = newFiles.some(file => file.size > ONE_HUNDRED_MB);
    
    if (hasLargeFile) {
      setWarning('Large file detected! Transfer will be optimized, but may take some time depending on your network.');
    }

    const fileObjects = newFiles.map(file => ({
      id: Date.now() + Math.random(),
      file: file,
      name: file.name,
      size: file.size,
      type: file.type,
      progress: 0
    }));
    
    setFiles(prev => [...prev, ...fileObjects]);
    setStatus(`${files.length + fileObjects.length} file(s) ready`);
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    addFiles(selectedFiles);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; 
    }
  };

  const removeFile = (fileId) => {
    setFiles(prev => {
      const updated = prev.filter(f => f.id !== fileId);
      if (updated.length === 0) setWarning('');
      return updated;
    });
  };

  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current++; if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragging(false); };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounterRef.current = 0; const droppedFiles = Array.from(e.dataTransfer.files); if (droppedFiles.length > 0) addFiles(droppedFiles); };

  const downloadAllAsZip = async () => {
    if (receivedFiles.length === 0) return;
    setDownloadingAll(true);
    setStatus('Packing files...');
    
    try {
      const zip = new JSZip();
      for (const file of receivedFiles) {
        zip.file(file.name, file.blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0'); 
      const yy = String(today.getFullYear()).slice(-2);
      
      const formattedDate = `${dd}-${mm}-${yy}`;
      
      const randomId = Math.floor(Math.random() * 9000) + 1000;
      
      const a = document.createElement('a');
      a.href = url;
      
      a.download = `posman-(${formattedDate})-${randomId}.zip`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('Downloaded!');
    } catch (error) {
      console.error('ZIP Error:', error);
      setStatus('Download failed');
    } finally {
      setDownloadingAll(false);
    }
  };

  const sendText = () => {
    const text = textDraft.trim();
    if (!text || !connectionRef.current?.open) {
      setStatus('Nothing to send');
      return;
    }
    connectionRef.current.send({ type: 'text', text });
    setSentTexts(prev => [{ id: Date.now() + Math.random(), text, at: new Date() }, ...prev]);
    setTextDraft('');
    setStatus('Text sent');
  };

  const copyText = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setStatus('Copy failed');
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(roomCode);
    setStatus('Room code copied!');
    setTimeout(() => setStatus('Ready to share'), 2000);
  };

  const getFileIcon = (type) => {
    if (!type) return <File size={18} />;
    if (type.startsWith('image/')) return <Image size={18} />;
    if (type.startsWith('video/')) return <Video size={18} />;
    if (type.includes('pdf') || type.includes('document')) return <FileText size={18} />;
    return <File size={18} />;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const connectionUrl = `${window.location.origin}?room=${roomCode}`;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room && peerRef.current && !connected) {
      setRemoteRoomCode(room);
      setTimeout(() => connectToRoom(), 1000);
    }
  }, [roomCode]);

  const fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const renderTextItem = (item) => (
    <div key={item.id} className="border border-line rounded-md p-[12px]">
      <p className="text-[14px] whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">{item.text}</p>
      <div className="flex items-center justify-between mt-[8px]">
        <span className="text-[12px] text-muted">{fmtTime(item.at)}</span>
        <button onClick={() => copyText(item.id, item.text)} className="btn-ghost !h-[28px] !px-[10px] !text-[12px]">
          {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
          {copiedId === item.id ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="min-h-screen text-ink pb-[64px]"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drag-overlay">
          <div className="text-center">
            <Upload size={32} className="mx-auto mb-[8px]" />
            <p className="text-[18px] font-medium">Drop files to add</p>
          </div>
        </div>
      )}

      <div className="max-w-[720px] mx-auto pt-[48px] px-[16px]">
        <header className="mb-[32px] fade-in flex items-end justify-between gap-[16px]">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Posman</h1>
            <p className="text-[14px] text-muted">Share files and text, directly. No login.</p>
          </div>
          <div className="flex items-center gap-[12px] min-w-0">
            <div className="flex items-center gap-[8px] text-[13px] text-muted min-w-0">
              <span className={`inline-block w-[8px] h-[8px] rounded-full shrink-0 ${connected ? 'bg-ink' : 'bg-line'}`} />
              <span className="truncate max-w-[160px]">{status}</span>
            </div>
            <button
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
              className="btn-ghost !px-0 w-[36px] shrink-0"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-[16px] mb-[24px] fade-in">
          <div className="card min-w-0">
            <p className="label mb-[8px]">Your code</p>
            <div className="flex gap-[8px]">
              <input type="text" value={roomCode} readOnly placeholder="------" className="input text-center font-mono tracking-widest" />
              <button onClick={copyToClipboard} disabled={!roomCode} className="btn-ghost !px-0 w-[36px] shrink-0" title="Copy code"><Copy size={14} /></button>
            </div>
            <button onClick={() => setShowQR(!showQR)} disabled={!roomCode} className="btn-ghost w-full mt-[8px]">
              {showQR ? 'Hide' : 'Show'} QR code
            </button>
            {showQR && roomCode && (
              <div className="mt-[12px] p-[12px] border border-line rounded-md flex justify-center bg-white">
                <QRCodeSVG value={connectionUrl} size={160} level="H" marginSize={1} />
              </div>
            )}
          </div>

          <div className="card min-w-0">
            <p className="label mb-[8px]">Join a room</p>
            <div className="flex gap-[8px]">
              <input type="text" inputMode="numeric" value={remoteRoomCode} onChange={(e) => setRemoteRoomCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" disabled={connected} maxLength={6} className="input text-center font-mono tracking-widest" />
              <button onClick={connectToRoom} disabled={connected || remoteRoomCode.length !== 6} className="btn shrink-0">
                {connected ? 'Connected' : 'Join'}
              </button>
            </div>
            <p className="text-[12px] text-muted mt-[12px]">Enter the other person's code, or scan their QR code.</p>
          </div>
        </div>

        {connected && (
          <div className="fade-in">
            <div className="tabs mb-[16px]">
              <button className={`tab ${mode === 'files' ? 'active' : ''}`} onClick={() => setMode('files')}>Files</button>
              <button className={`tab ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')}>
                Text{receivedTexts.length > 0 ? ` (${receivedTexts.length})` : ''}
              </button>
            </div>

            {mode === 'text' && (
              <div className="space-y-[16px]">
                <div className="card">
                  <p className="label mb-[8px]">Send text</p>
                  <textarea
                    value={textDraft}
                    onChange={(e) => setTextDraft(e.target.value)}
                    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendText(); }}
                    placeholder="Paste or type something to share…"
                    maxLength={100000}
                    className="textarea"
                  />
                  <div className="flex items-center justify-between mt-[12px]">
                    <span className="text-[12px] text-muted">Ctrl + Enter to send</span>
                    <button onClick={sendText} disabled={!textDraft.trim()} className="btn">Send text</button>
                  </div>
                </div>

                <div className="card">
                  <p className="label mb-[12px]">Received ({receivedTexts.length})</p>
                  {receivedTexts.length === 0
                    ? <p className="text-[14px] text-muted">Nothing yet.</p>
                    : <div className="space-y-[8px]">{receivedTexts.map(renderTextItem)}</div>}
                </div>

                {sentTexts.length > 0 && (
                  <div className="card">
                    <p className="label mb-[12px]">Sent ({sentTexts.length})</p>
                    <div className="space-y-[8px]">{sentTexts.map(renderTextItem)}</div>
                  </div>
                )}
              </div>
            )}

            {mode === 'files' && (
              <div className="space-y-[16px]">
                <div className="card">
                  <p className="label mb-[8px]">Send files</p>
                  <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
                  <button onClick={() => fileInputRef.current.click()} className="w-full py-[28px] border border-dashed border-line rounded-md hover:border-ink transition-colors flex items-center justify-center gap-[10px] text-muted text-[14px]">
                    <Upload size={18} /> Choose files or drag & drop
                  </button>

                  {warning && (
                    <div className="mt-[12px] p-[10px] border border-warn rounded-md flex items-start gap-[10px] text-warn text-[13px]">
                      <AlertTriangle size={16} className="shrink-0 mt-[1px]" />
                      <p>{warning}</p>
                    </div>
                  )}

                  {files.length > 0 && (
                    <div className="space-y-[8px] max-h-[240px] overflow-y-auto mt-[12px]">
                      {files.map((fileObj) => (
                        <div key={fileObj.id} className="p-[10px] border border-line rounded-md flex items-center gap-[12px]">
                          <div className="shrink-0 text-muted">{getFileIcon(fileObj.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] truncate">{fileObj.name}</p>
                            <p className="text-[12px] text-muted">{formatFileSize(fileObj.size)}</p>
                            {fileObj.progress > 0 && <div className="mt-[6px] progress-track"><div className="progress-fill" style={{ width: `${fileObj.progress}%` }} /></div>}
                          </div>
                          <button onClick={() => removeFile(fileObj.id)} className="p-[6px] text-muted hover:text-ink shrink-0"><X size={16} /></button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button onClick={sendFiles} disabled={files.length === 0} className="btn w-full mt-[12px]">
                    <Upload size={14} /> Send {files.length > 0 ? `${files.length} file(s)` : 'files'}
                  </button>
                </div>

                {(receivedFiles.length > 0 || Object.keys(receivingProgress).length > 0) && (
                  <div className="card">
                    <div className="flex items-center justify-between mb-[12px]">
                      <p className="label">Received ({receivedFiles.length})</p>
                      <button onClick={downloadAllAsZip} disabled={downloadingAll || receivedFiles.length === 0} className="btn-ghost">
                        <PackageOpen size={14} />{downloadingAll ? 'Packing…' : 'Download all'}
                      </button>
                    </div>
                    <div className="space-y-[8px] max-h-[280px] overflow-y-auto">
                      {Object.entries(receivingProgress).map(([fileName, info]) => (
                        <div key={`incoming-${fileName}`} className="p-[10px] border border-line rounded-md flex items-center gap-[12px]">
                          <div className="shrink-0 text-muted">{getFileIcon(info.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] truncate">{fileName}</p>
                            <p className="text-[12px] text-muted">Receiving… {formatFileSize(info.size)}</p>
                            <div className="mt-[6px] progress-track"><div className="progress-fill" style={{ width: `${info.progress}%` }} /></div>
                          </div>
                          <span className="text-[12px] text-muted">{info.progress}%</span>
                        </div>
                      ))}
                      {receivedFiles.map((file) => (
                        <div key={file.id} className="p-[10px] border border-line rounded-md flex items-center gap-[12px]">
                          <div className="shrink-0 text-muted">{getFileIcon(file.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] truncate">{file.name}</p>
                            <p className="text-[12px] text-muted">{formatFileSize(file.size)}</p>
                          </div>
                          <a href={file.url} download={file.name} className="btn-ghost !h-[30px]"><Download size={14} /> Get</a>
                          <button onClick={() => removeReceivedFile(file.id, file.url)} className="p-[6px] text-muted hover:text-ink" title="Remove"><X size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!connected && (
          <p className="text-[13px] text-muted mt-[24px]">
            Peer-to-peer over WebRTC. Nothing is stored on a server. Connect with a 6-digit code to share files or text.
          </p>
        )}
      </div>

      <SpeedInsights />
    </div>
  );
}
