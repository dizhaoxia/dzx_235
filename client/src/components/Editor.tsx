import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createEditor, Descendant, Editor as SlateEditor, Element as SlateElement, Transforms, Node } from 'slate';
import { Slate, Editable, withReact } from 'slate-react';
import { withHistory } from 'slate-history';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { withYjs, YjsEditor, toSharedType, toSlateDoc, SharedType } from 'slate-yjs';
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
    const isActive = CustomEditor.isBoldMarkActive(editor);
    if (isActive) {
      SlateEditor.removeMark(editor, 'bold');
    } else {
      SlateEditor.addMark(editor, 'bold', true);
    }
  },

  toggleItalicMark(editor: SlateEditor) {
    const isActive = CustomEditor.isItalicMarkActive(editor);
    if (isActive) {
      SlateEditor.removeMark(editor, 'italic');
    } else {
      SlateEditor.addMark(editor, 'italic', true);
    }
  },

  toggleUnderlineMark(editor: SlateEditor) {
    const isActive = CustomEditor.isUnderlineMarkActive(editor);
    if (isActive) {
      SlateEditor.removeMark(editor, 'underline');
    } else {
      SlateEditor.addMark(editor, 'underline', true);
    }
  },

  toggleCodeMark(editor: SlateEditor) {
    const isActive = CustomEditor.isCodeMarkActive(editor);
    if (isActive) {
      SlateEditor.removeMark(editor, 'code');
    } else {
      SlateEditor.addMark(editor, 'code', true);
    }
  },

  toggleBlock(editor: SlateEditor, format: string) {
    const isActive = CustomEditor.isBlockActive(editor, format);
    const isList = format === 'bulleted-list' || format === 'numbered-list';

    const newType = isActive ? 'paragraph' : isList ? 'list-item' : format;

    Transforms.unwrapNodes(editor, {
      match: (n: any) => !SlateEditor.isEditor(n) && SlateElement.isElement(n) &&
        ['bulleted-list', 'numbered-list'].includes(n.type),
      split: true
    });

    Transforms.setNodes(editor, { type: newType } as any);

    if (!isActive && isList) {
      const block = { type: format, children: [] } as any;
      Transforms.wrapNodes(editor, block);
    }
  }
};

const Leaf: React.FC<{ attributes: any; children: any; leaf: any }> = ({ attributes, children, leaf }) => {
  if (leaf.bold) {
    children = <strong>{children}</strong>;
  }
  if (leaf.italic) {
    children = <em>{children}</em>;
  }
  if (leaf.underline) {
    children = <u>{children}</u>;
  }
  if (leaf.code) {
    children = <code className="inline-code">{children}</code>;
  }
  return <span {...attributes}>{children}</span>;
};

const Element: React.FC<{ attributes: any; children: any; element: any }> = ({ attributes, children, element }) => {
  switch (element.type) {
    case 'heading-one':
      return <h1 {...attributes}>{children}</h1>;
    case 'heading-two':
      return <h2 {...attributes}>{children}</h2>;
    case 'heading-three':
      return <h3 {...attributes}>{children}</h3>;
    case 'block-quote':
      return <blockquote {...attributes}>{children}</blockquote>;
    case 'bulleted-list':
      return <ul {...attributes}>{children}</ul>;
    case 'numbered-list':
      return <ol {...attributes}>{children}</ol>;
    case 'list-item':
      return <li {...attributes}>{children}</li>;
    default:
      return <p {...attributes}>{children}</p>;
  }
};

const Editor: React.FC<EditorProps> = ({ docId, userInfo }) => {
  const [value, setValue] = useState<Descendant[]>(createEmptyValue());
  const [onlineUsers, setOnlineUsers] = useState<AwarenessUser[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connected, setConnected] = useState(false);
  const prevUsersRef = useRef<Map<number, UserInfo>>(new Map());
  const yjsEditorRef = useRef<any>(null);

  const addNotification = useCallback((message: string, type: 'join' | 'leave') => {
    const id = `${Date.now()}-${Math.random()}`;
    setNotifications(prev => [...prev, { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  }, []);

  const { editor, provider, ydoc } = useMemo(() => {
    const baseEditor = withHistory(withReact(createEditor()));
    const ydocInstance = new Y.Doc();
    const sharedType = ydocInstance.get('content', Y.Array) as SharedType;

    if (sharedType.length === 0) {
      const initialValue = createEmptyValue();
      toSharedType(sharedType, initialValue as Node[]);
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname;
    const apiPort = 3001;
    const providerInstance = new WebsocketProvider(
      `${wsProtocol}//${wsHost}:${apiPort}`,
      docId,
      ydocInstance,
      { connect: true }
    );

    const yjsEditor = withYjs(baseEditor, sharedType, { synchronizeValue: true });
    yjsEditorRef.current = yjsEditor;

    const initialSlateValue = toSlateDoc(sharedType);

    return { editor: yjsEditor, provider: providerInstance, ydoc: ydocInstance, initialValue: initialSlateValue };
  }, [docId]);

  useEffect(() => {
    const initialValue = toSlateDoc(YjsEditor.sharedType(editor));
    setValue(initialValue as Descendant[]);
  }, [editor]);

  useEffect(() => {
    provider.on('status', (event: any) => {
      setConnected(event.status === 'connected');
    });

    const awareness = provider.awareness;
    awareness.setLocalStateField('user', userInfo);

    const updateUsers = () => {
      const states = awareness.getStates();
      const users: AwarenessUser[] = [];
      const currentClientIds = new Set<number>();

      states.forEach((state, clientId) => {
        if (state && state.user) {
          users.push({
            clientId,
            user: state.user
          });
          currentClientIds.add(clientId);

          if (!prevUsersRef.current.has(clientId) && clientId !== awareness.clientID) {
            addNotification(`${state.user.name} 加入了文档`, 'join');
          }
          prevUsersRef.current.set(clientId, state.user);
        }
      });

      prevUsersRef.current.forEach((user, clientId) => {
        if (!currentClientIds.has(clientId) && clientId !== awareness.clientID) {
          addNotification(`${user.name} 离开了文档`, 'leave');
          prevUsersRef.current.delete(clientId);
        }
      });

      setOnlineUsers(users);
    };

    awareness.on('change', updateUsers);
    updateUsers();

    const syncHandler = () => {
      try {
        YjsEditor.synchronizeValue(editor);
      } catch (e) {
        console.error('Sync error:', e);
      }
    };

    const sharedType = YjsEditor.sharedType(editor);
    sharedType.observeDeep(syncHandler);

    return () => {
      awareness.off('change', updateUsers);
      sharedType.unobserveDeep(syncHandler);
      try {
        if (yjsEditorRef.current) {
          YjsEditor.destroy(yjsEditorRef.current);
        }
      } catch (e) {
        console.error('Error destroying:', e);
      }
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc, userInfo, addNotification, editor]);

  const handleChange = useCallback((newValue: Descendant[]) => {
    setValue(newValue);
  }, []);

  const renderElement = useCallback((props: any) => <Element {...props} />, []);
  const renderLeaf = useCallback((props: any) => <Leaf {...props} />, []);

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
          initialValue={value}
          onChange={handleChange}
        >
          <Toolbar editor={editor as any} />

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
