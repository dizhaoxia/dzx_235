import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createEditor, Descendant, Editor as SlateEditor, Element as SlateElement, Transforms, Node } from 'slate';
import { Slate, Editable, withReact } from 'slate-react';
import { withHistory } from 'slate-history';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { withYjs, YjsEditor, SharedType, toSharedType } from 'slate-yjs';
import Toolbar from './Toolbar';
import UsersList from './UsersList';
import Notifications from './Notifications';

interface UserInfo {
  id: string;
  name: string;
  color: string;
}

interface AwarenessUser {
  clientId: number;
  user: UserInfo;
}

interface Notification {
  id: string;
  message: string;
  type: 'join' | 'leave';
  timestamp: number;
}

interface EditorProps {
  docId: string;
  userInfo: UserInfo;
}

type CustomElement = {
  type: string;
  children: any[];
};

const createEmptyValue = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: '' }]
  } as CustomElement as any
];

const CustomEditor = {
  isBoldMarkActive(editor: SlateEditor) {
    const marks: any = SlateEditor.marks(editor);
    return marks ? marks.bold === true : false;
  },
  isItalicMarkActive(editor: SlateEditor) {
    const marks: any = SlateEditor.marks(editor);
    return marks ? marks.italic === true : false;
  },
  isUnderlineMarkActive(editor: SlateEditor) {
    const marks: any = SlateEditor.marks(editor);
    return marks ? marks.underline === true : false;
  },
  isCodeMarkActive(editor: SlateEditor) {
    const marks: any = SlateEditor.marks(editor);
    return marks ? marks.code === true : false;
  },
  isBlockActive(editor: SlateEditor, format: string) {
    const { selection } = editor;
    if (!selection) return false;
    const [match] = Array.from(
      SlateEditor.nodes(editor, {
        at: SlateEditor.unhangRange(editor, selection),
        match: n => !SlateEditor.isEditor(n) && SlateElement.isElement(n) && (n as any).type === format
      })
    );
    return !!match;
  },
  toggleBoldMark(editor: SlateEditor) {
    CustomEditor.isBoldMarkActive(editor)
      ? SlateEditor.removeMark(editor, 'bold')
      : SlateEditor.addMark(editor, 'bold', true);
  },
  toggleItalicMark(editor: SlateEditor) {
    CustomEditor.isItalicMarkActive(editor)
      ? SlateEditor.removeMark(editor, 'italic')
      : SlateEditor.addMark(editor, 'italic', true);
  },
  toggleUnderlineMark(editor: SlateEditor) {
    CustomEditor.isUnderlineMarkActive(editor)
      ? SlateEditor.removeMark(editor, 'underline')
      : SlateEditor.addMark(editor, 'underline', true);
  },
  toggleCodeMark(editor: SlateEditor) {
    CustomEditor.isCodeMarkActive(editor)
      ? SlateEditor.removeMark(editor, 'code')
      : SlateEditor.addMark(editor, 'code', true);
  },
  toggleBlock(editor: SlateEditor, format: string) {
    const isActive = CustomEditor.isBlockActive(editor, format);
    const isList = format === 'bulleted-list' || format === 'numbered-list';
    const newType = isActive ? 'paragraph' : isList ? 'list-item' : format;
    Transforms.unwrapNodes(editor, {
      match: (n) => !SlateEditor.isEditor(n) && SlateElement.isElement(n) &&
        ['bulleted-list', 'numbered-list'].includes((n as any).type),
      split: true
    });
    Transforms.setNodes(editor, { type: newType } as any);
    if (!isActive && isList) {
      Transforms.wrapNodes(editor, { type: format, children: [] } as any);
    }
  }
};

const Leaf: React.FC<{ attributes: any; children: any; leaf: any }> = ({ attributes, children, leaf }) => {
  if (leaf.bold) children = <strong>{children}</strong>;
  if (leaf.italic) children = <em>{children}</em>;
  if (leaf.underline) children = <u>{children}</u>;
  if (leaf.code) children = <code className="inline-code">{children}</code>;
  return <span {...attributes}>{children}</span>;
};

const Element: React.FC<{ attributes: any; children: any; element: any }> = ({ attributes, children, element }) => {
  switch (element.type) {
    case 'heading-one':   return <h1 {...attributes}>{children}</h1>;
    case 'heading-two':   return <h2 {...attributes}>{children}</h2>;
    case 'heading-three': return <h3 {...attributes}>{children}</h3>;
    case 'block-quote':   return <blockquote {...attributes}>{children}</blockquote>;
    case 'bulleted-list': return <ul {...attributes}>{children}</ul>;
    case 'numbered-list': return <ol {...attributes}>{children}</ol>;
    case 'list-item':     return <li {...attributes}>{children}</li>;
    default:              return <p {...attributes}>{children}</p>;
  }
};

const Editor: React.FC<EditorProps> = ({ docId, userInfo }) => {
  const [resources, setResources] = useState<{
    ydoc: Y.Doc;
    sharedType: SharedType;
    provider: WebsocketProvider;
    awareness: any;
  } | null>(null);
  const [editor, setEditor] = useState<any>(null);
  const [onlineUsers, setOnlineUsers] = useState<AwarenessUser[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);

  const prevUsersRef = useRef<Map<number, UserInfo>>(new Map());
  const onSyncRef = useRef<((s: boolean) => void) | null>(null);
  const onStatusRef = useRef<((e: any) => void) | null>(null);
  const onAwarenessRef = useRef<(() => void) | null>(null);

  const addNotification = useCallback((message: string, type: 'join' | 'leave') => {
    const id = `${Date.now()}-${Math.random()}`;
    setNotifications(prev => [...prev, { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    let isActive = true;
    let didSync = false;

    const ydocInstance = new Y.Doc();
    const sharedTypeInstance = ydocInstance.get('content', Y.Array) as SharedType;

    const apiHost = window.location.hostname;
    const apiPort = 3001;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${apiHost}:${apiPort}`;

    const onSyncWrap = (s: boolean) => { if (onSyncRef.current) onSyncRef.current(s); };
    const onStatusWrap = (e: any) => { if (onStatusRef.current) onStatusRef.current(e); };
    const onAwarenessWrap = () => { if (onAwarenessRef.current) onAwarenessRef.current(); };

    const providerInstance = new WebsocketProvider(wsUrl, docId, ydocInstance, {
      connect: true,
      disableBc: true,
      params: {}
    });
    const awarenessInstance = providerInstance.awareness;

    providerInstance.on('sync', onSyncWrap);
    providerInstance.on('status', onStatusWrap);
    awarenessInstance.on('change', onAwarenessWrap);

    const editorInstance = withHistory(withReact(withYjs(createEditor(), sharedTypeInstance, { synchronizeValue: false })));

    if (isActive) {
      setResources({
        ydoc: ydocInstance,
        sharedType: sharedTypeInstance,
        provider: providerInstance,
        awareness: awarenessInstance
      });
      setEditor(editorInstance);
    }

    const updateUsers = () => {
      const states = awarenessInstance.getStates();
      const users: AwarenessUser[] = [];
      const currentClientIds = new Set<number>();

      states.forEach((state, clientId) => {
        if (state && state.user) {
          users.push({ clientId, user: state.user });
          currentClientIds.add(clientId);

          if (!prevUsersRef.current.has(clientId) && clientId !== awarenessInstance.clientID) {
            addNotification(`${state.user.name} 加入了文档`, 'join');
          }
          prevUsersRef.current.set(clientId, state.user);
        }
      });

      prevUsersRef.current.forEach((user, clientId) => {
        if (!currentClientIds.has(clientId) && clientId !== awarenessInstance.clientID) {
          addNotification(`${user.name} 离开了文档`, 'leave');
          prevUsersRef.current.delete(clientId);
        }
      });

      if (isActive) setOnlineUsers(users);
    };

    const finishSync = () => {
      if (didSync || !isActive) return;
      didSync = true;

      if (sharedTypeInstance.length === 0) {
        const empty = createEmptyValue();
        toSharedType(sharedTypeInstance, empty as Node[]);
      }

      YjsEditor.synchronizeValue(editorInstance);
      setSynced(true);
      setTimeout(() => updateUsers(), 30);
    };

    onSyncRef.current = (isSync: boolean) => {
      if (isSync) finishSync();
    };

    onStatusRef.current = (event: any) => {
      if (isActive) setConnected(event.status === 'connected');
      if (event.status === 'connected') {
        awarenessInstance.setLocalStateField('user', userInfo);
        setTimeout(() => updateUsers(), 80);
        if (providerInstance.synced) finishSync();
      }
    };

    onAwarenessRef.current = updateUsers;

    if (providerInstance.wsconnected) {
      setConnected(true);
      awarenessInstance.setLocalStateField('user', userInfo);
    }
    if (providerInstance.synced) {
      finishSync();
    }

    setTimeout(() => {
      if (!didSync && isActive) {
        finishSync();
        updateUsers();
      }
    }, 2500);

    return () => {
      isActive = false;
      onSyncRef.current = null;
      onStatusRef.current = null;
      onAwarenessRef.current = null;

      try { providerInstance.off('sync', onSyncWrap); } catch (e) {}
      try { providerInstance.off('status', onStatusWrap); } catch (e) {}
      try { awarenessInstance.off('change', onAwarenessWrap); } catch (e) {}
      try { awarenessInstance.setLocalState(null); } catch (e) {}
      try { providerInstance.destroy(); } catch (e) {}
      try { YjsEditor.destroy(editorInstance); } catch (e) {}
    };
  }, [docId, userInfo, addNotification]);

  const renderElement = useCallback((props: any) => <Element {...props} />, []);
  const renderLeaf = useCallback((props: any) => <Leaf {...props} />, []);

  if (!editor || !resources || !synced) {
    return (
      <div className="editor-container">
        <div className="editor-sidebar">
          <UsersList users={onlineUsers} currentUserId={userInfo.id} />
        </div>
        <div className="editor-main">
          <div className="status-disconnected">
            <span className="status-dot"></span> 加载编辑器...
          </div>
          <div style={{ padding: '80px', textAlign: 'center', color: '#6b7280' }}>
            正在同步文档内容，请稍候...
          </div>
        </div>
        <Notifications notifications={notifications} />
      </div>
    );
  }

  return (
    <div className="editor-container">
      <div className="editor-sidebar">
        <UsersList users={onlineUsers} currentUserId={userInfo.id} />
      </div>
      <div className="editor-main">
        {connected ? (
          <div className="status-connected">
            <span className="status-dot"></span> 已连接
          </div>
        ) : (
          <div className="status-disconnected">
            <span className="status-dot"></span> 连接中...
          </div>
        )}

        <Slate
          editor={editor}
          initialValue={editor.children as any}
          onChange={() => {}}
        >
          <Toolbar editor={editor} />
          <div className="editor-wrapper">
            <Editable
              renderElement={renderElement}
              renderLeaf={renderLeaf}
              placeholder="开始输入内容..."
              spellCheck
              className="slate-editor"
            />
          </div>
        </Slate>
      </div>
      <Notifications notifications={notifications} />
    </div>
  );
};

export default Editor;
