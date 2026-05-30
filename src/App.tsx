import { useState, useRef, useCallback, useEffect } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-editor-react';
import '@eigenpal/docx-editor-react/styles.css';
import AgentChat from './AgentChat';

interface ModelOption {
  id: string;
  name: string;
  fast: boolean;
}

export default function App() {
  const editorRef = useRef<DocxEditorRef>(null);
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(() => {
    const saved = localStorage.getItem('docx_editor_buffer');
    if (saved) {
      const binaryString = window.atob(saved);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }
    return null;
  });
  const [fileName, setFileName] = useState<string>(() => localStorage.getItem('docx_editor_filename') || 'Untitled.docx');
  const [agentOpen, setAgentOpen] = useState(true);
  const [editorKey, setEditorKey] = useState(0);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('openai-codex/gpt-5.5');

  // Fetch available models on mount
  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then(setModels)
      .catch(() => {
        // Fallback if API not running yet
        setModels([
          { id: 'openai-codex/gpt-5.5', name: 'Codex GPT-5.5', fast: false },
          { id: 'openai-codex/gpt-5.3-codex', name: 'Codex GPT-5.3', fast: false },
          { id: 'openai-codex/gpt-5.3-codex-spark', name: 'Codex GPT-5.3 Spark', fast: true },
          { id: 'openai-codex/gpt-5.4-mini', name: 'Codex GPT-5.4 Mini', fast: true },
          { id: 'openai-codex/gpt-5.4', name: 'Codex GPT-5.4', fast: false },
        ]);
      });
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (documentBuffer) {
      const bytes = new Uint8Array(documentBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      localStorage.setItem('docx_editor_buffer', window.btoa(binary));
    }
    localStorage.setItem('docx_editor_filename', fileName);
  }, [documentBuffer, fileName]);

  // Periodic auto-save while editing
  useEffect(() => {
    const interval = setInterval(async () => {
      const buffer = await editorRef.current?.save();
      if (buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        localStorage.setItem('docx_editor_buffer', window.btoa(binary));
      }
    }, 10000); // Auto-save every 10s
    return () => clearInterval(interval);
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.docx')) {
      loadFile(file);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }, []);

  const loadFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    setDocumentBuffer(buffer);
    setFileName(file.name);
    setEditorKey((k) => k + 1);
  };

  const handleSave = async () => {
    const buffer = await editorRef.current?.save();
    if (buffer) {
      // Update localStorage with the latest content
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      localStorage.setItem('docx_editor_buffer', window.btoa(binary));

      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'document.docx';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const loadDemo = async () => {
    try {
      const resp = await fetch('https://docx-editor.dev/demo/contract-template.docx');
      if (resp.ok) {
        const buffer = await resp.arrayBuffer();
        setDocumentBuffer(buffer);
        setFileName('demo-contract.docx');
        setEditorKey((k) => k + 1);
      }
    } catch {
      // Demo fetch failed
    }
  };

  return (
    <div style={styles.app}>
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <span style={styles.logo}>✦</span>
          <span style={styles.fileName}>{fileName}</span>
        </div>
        <div style={styles.toolbarRight}>
          <select
            style={styles.modelSelect}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fast ? '⚡ ' : ''}{m.name}
              </option>
            ))}
          </select>
          <label style={styles.toolBtn}>
            Open
            <input type="file" accept=".docx" onChange={handleFileSelect} style={{ display: 'none' }} />
          </label>
          <button style={styles.saveBtn} onClick={handleSave}>Save</button>
          <button
            style={{ ...styles.agentToggle, ...(agentOpen ? styles.agentToggleActive : {}) }}
            onClick={() => setAgentOpen(!agentOpen)}
          >
            ✦ Agent {agentOpen ? '▾' : '▸'}
          </button>
        </div>
      </div>

      <div style={styles.main}>
        <div style={styles.editorPane}>
          <DocxEditor
            key={editorKey}
            ref={editorRef}
            documentBuffer={documentBuffer}
            author="User"
            showToolbar
            showZoomControl
            mode="editing"
          />
        </div>

        {agentOpen && (
          <div style={styles.agentPane}>
            <AgentChat editorRef={editorRef} selectedModel={selectedModel} />
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  dropZone: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  dropCard: {
    background: '#fff',
    borderRadius: '16px',
    padding: '48px',
    textAlign: 'center',
    boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
    maxWidth: '420px',
  },
  dropIcon: { fontSize: '48px', marginBottom: '16px' },
  dropTitle: { fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' },
  dropText: { fontSize: '14px', color: '#6b7280', marginBottom: '24px' },
  uploadBtn: {
    display: 'inline-block',
    padding: '12px 28px',
    background: '#4f46e5',
    color: '#fff',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    marginBottom: '12px',
  },
  demoBtn: {
    display: 'block',
    width: '100%',
    padding: '10px',
    background: 'transparent',
    color: '#6b7280',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  app: { display: 'flex', flexDirection: 'column', height: '100%', background: '#f3f4f6' },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    zIndex: 10,
  },
  toolbarLeft: { display: 'flex', alignItems: 'center', gap: '10px' },
  logo: { fontSize: '20px', color: '#4f46e5' },
  fileName: { fontSize: '14px', fontWeight: 600, color: '#111827' },
  toolbarRight: { display: 'flex', alignItems: 'center', gap: '8px' },
  modelSelect: {
    padding: '6px 10px',
    background: '#f9fafb',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#374151',
    cursor: 'pointer',
    outline: 'none',
  },
  toolBtn: {
    padding: '6px 14px',
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '13px',
    cursor: 'pointer',
    color: '#374151',
  },
  saveBtn: {
    padding: '6px 14px',
    background: '#4f46e5',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    color: '#fff',
  },
  agentToggle: {
    padding: '6px 14px',
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '13px',
    cursor: 'pointer',
    color: '#374151',
    transition: 'all 0.15s',
  },
  agentToggleActive: { background: '#eef2ff', borderColor: '#818cf8', color: '#4f46e5' },
  main: { flex: 1, display: 'flex', overflow: 'hidden' },
  editorPane: { flex: 1, overflow: 'hidden' },
  agentPane: {
    width: '380px',
    borderLeft: '1px solid #e5e7eb',
    background: '#fafafa',
    display: 'flex',
    flexDirection: 'column',
  },
};
