import React, { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Editor from './components/Editor';

interface Document {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}

const USER_COLORS = [
  '#FF5733', '#33FF57', '#3357FF', '#F333FF', '#FF33A1',
  '#33FFF5', '#FFC733', '#8A33FF', '#33FF8A', '#FF8A33'
];

const generateUsername = () => {
  const adjectives = ['快乐的', '聪明的', '勇敢的', '友善的', '热情的', '认真的', '活泼的', '优雅的'];
  const nouns = ['小猫', '小狗', '熊猫', '兔子', '松鼠', '狐狸', '企鹅', '海豚'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
};

const getUserInfo = () => {
  let userInfo = localStorage.getItem('collab-user-info');
  if (userInfo) {
    return JSON.parse(userInfo);
  }
  const info = {
    id: uuidv4(),
    name: generateUsername(),
    color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
  };
  localStorage.setItem('collab-user-info', JSON.stringify(info));
  return info;
};

function App() {
  const [currentDoc, setCurrentDoc] = useState<string | null>(null);
  const [currentDocTitle, setCurrentDocTitle] = useState<string>('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [userInfo] = useState(getUserInfo);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(userInfo.name);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (e) {
      console.error('Failed to fetch documents:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const createDocument = async () => {
    const id = uuidv4();
    const title = `未命名文档 ${new Date().toLocaleString('zh-CN')}`;
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title })
      });
      if (res.ok) {
        setCurrentDoc(id);
        setCurrentDocTitle(title);
        fetchDocuments();
      }
    } catch (e) {
      console.error('Failed to create document:', e);
    }
  };

  const openDocument = async (doc: Document) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentDoc(doc.id);
        setCurrentDocTitle(data.title || doc.title);
      }
    } catch (e) {
      console.error('Failed to open document:', e);
    }
  };

  const deleteDocument = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个文档吗？')) return;
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchDocuments();
      }
    } catch (e) {
      console.error('Failed to delete document:', e);
    }
  };

  const goBack = () => {
    setCurrentDoc(null);
    setCurrentDocTitle('');
    fetchDocuments();
  };

  const saveUserName = () => {
    if (tempName.trim()) {
      const newInfo = { ...userInfo, name: tempName.trim() };
      localStorage.setItem('collab-user-info', JSON.stringify(newInfo));
      window.location.reload();
    }
    setEditingName(false);
  };

  if (currentDoc) {
    return (
      <div className="app">
        <div className="editor-header">
          <button className="back-btn" onClick={goBack}>
            ← 返回文档列表
          </button>
          <h1 className="doc-title">{currentDocTitle}</h1>
          <div className="user-info-header">
            <span className="user-avatar" style={{ backgroundColor: userInfo.color }}>
              {userInfo.name.charAt(0)}
            </span>
            <span className="user-name">{userInfo.name}</span>
          </div>
        </div>
        <Editor docId={currentDoc} userInfo={userInfo} />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="home-container">
        <div className="home-header">
          <h1 className="app-title">📝 多人协同文档编辑器</h1>
          <div className="user-info">
            <span className="user-avatar" style={{ backgroundColor: userInfo.color }}>
              {userInfo.name.charAt(0)}
            </span>
            {editingName ? (
              <div className="name-edit">
                <input
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveUserName()}
                  autoFocus
                />
                <button onClick={saveUserName}>✓</button>
                <button onClick={() => { setEditingName(false); setTempName(userInfo.name); }}>✕</button>
              </div>
            ) : (
              <span className="user-name" onClick={() => setEditingName(true)}>
                {userInfo.name} ✏️
              </span>
            )}
          </div>
        </div>

        <div className="actions">
          <button className="create-btn" onClick={createDocument}>
            + 新建文档
          </button>
        </div>

        {loading ? (
          <div className="loading">加载中...</div>
        ) : documents.length === 0 ? (
          <div className="empty-state">
            <p>还没有文档</p>
            <p>点击上方按钮创建你的第一个协同文档吧！</p>
          </div>
        ) : (
          <div className="document-list">
            {documents.map((doc) => (
              <div key={doc.id} className="document-card" onClick={() => openDocument(doc)}>
                <div className="doc-icon">📄</div>
                <div className="doc-info">
                  <h3 className="doc-list-title">{doc.title}</h3>
                  <p className="doc-meta">
                    {doc.updatedAt ? `更新于 ${new Date(doc.updatedAt).toLocaleString('zh-CN')}` : ''}
                  </p>
                </div>
                <button className="delete-btn" onClick={(e) => deleteDocument(doc.id, e)}>
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
