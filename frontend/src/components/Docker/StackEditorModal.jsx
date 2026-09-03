import React, { useState, useEffect } from 'react';
import { X, Save, Play, RefreshCw, AlertCircle } from 'lucide-react';
import Editor from '@monaco-editor/react';

export default function StackEditorModal({ agentId, stackName, onClose }) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fetchFile = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/agents/${agentId}/docker/stacks/${stackName}/file`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Fehler beim Laden der Stack-Datei');
      }
      const data = await res.json();
      setContent(data.content || '');
      setOriginalContent(data.content || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFile();
  }, [agentId, stackName]);

  const handleSave = async (andDeploy = false) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    if (andDeploy) setDeploying(true);
    
    try {
      const token = localStorage.getItem('token');
      // Save file
      let res = await fetch(`/api/agents/${agentId}/docker/stacks/${stackName}/file`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Fehler beim Speichern');
      }
      
      setOriginalContent(content);
      
      if (andDeploy) {
        // Deploy stack (start maps to docker compose up)
        res = await fetch(`/api/agents/${agentId}/docker/stacks/${stackName}/start`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Fehler beim Ausrollen des Stacks');
        }
        setSuccess('Stack erfolgreich gespeichert und ausgerollt!');
      } else {
        setSuccess('Datei erfolgreich gespeichert!');
      }
      
      setTimeout(() => setSuccess(null), 3000);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      setDeploying(false);
    }
  };

  const hasChanges = content !== originalContent;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-panel-900 border border-panel-800 rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-panel-800 bg-panel-950/50">
          <div>
            <h3 className="font-semibold text-gray-100 flex items-center">
              Stack Editor: <span className="ml-2 text-blue-400 font-mono text-sm">{stackName}</span>
            </h3>
            {hasChanges && <span className="text-xs text-amber-500 font-medium ml-1">Ungespeicherte Änderungen</span>}
          </div>
          
          <div className="flex items-center space-x-3">
            {error && <span className="text-sm text-red-400 flex items-center"><AlertCircle size={14} className="mr-1" /> {error}</span>}
            {success && <span className="text-sm text-green-400">{success}</span>}
            
            <button
              onClick={() => handleSave(false)}
              disabled={loading || saving || deploying || !hasChanges}
              className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                hasChanges 
                  ? 'bg-panel-800 hover:bg-panel-700 text-white' 
                  : 'bg-panel-800/50 text-gray-500 cursor-not-allowed'
              }`}
            >
              {saving && !deploying ? <RefreshCw size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
              Speichern
            </button>
            
            <button
              onClick={() => handleSave(true)}
              disabled={loading || saving || deploying}
              className="flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              {deploying ? <RefreshCw size={16} className="mr-2 animate-spin" /> : <Play size={16} className="mr-2" />}
              Speichern & Deploy
            </button>
            
            <div className="h-6 w-px bg-panel-800 mx-2"></div>
            
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-panel-800 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 relative bg-[#1e1e1e]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]/80 z-10">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          )}
          
          {!loading && error && !content && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e1e] z-10 p-6 text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
              <h4 className="text-lg font-medium text-gray-200 mb-2">Datei konnte nicht geladen werden</h4>
              <p className="text-gray-400">{error}</p>
            </div>
          )}
          
          <Editor
            height="100%"
            defaultLanguage="yaml"
            theme="vs-dark"
            value={content}
            onChange={(value) => setContent(value || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 16 }
            }}
          />
        </div>
      </div>
    </div>
  );
}
