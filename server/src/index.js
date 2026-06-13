import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as syncProtocol from 'y-protocols/sync.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const PORT = process.env.PORT || 3001;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json());

const docs = new Map();
const wsServer = createServer(app);
const wss = new WebSocketServer({ server: wsServer });

const messageSync = 0;
const messageAwareness = 1;

function getDoc(docId) {
  if (docs.has(docId)) {
    return docs.get(docId);
  }

  const ydoc = new Y.Doc();
  const filePath = path.join(DATA_DIR, `${docId}.bin`);

  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath);
      Y.applyUpdate(ydoc, new Uint8Array(data));
    } catch (e) {
      console.error('Error loading document:', e);
    }
  }

  const awareness = new awarenessProtocol.Awareness(ydoc);

  let saveTimeout = null;
  ydoc.on('update', () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      try {
        const state = Y.encodeStateAsUpdate(ydoc);
        fs.writeFileSync(filePath, Buffer.from(state));
      } catch (e) {
        console.error('Error saving document:', e);
      }
    }, 1000);
  });

  const doc = { ydoc, awareness, filePath };
  docs.set(docId, doc);
  return doc;
}

app.get('/api/documents', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const documents = files.map(file => {
      const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
      return {
        id: file.replace('.json', ''),
        title: content.title || 'Untitled',
        updatedAt: content.updatedAt || null
      };
    });
    res.json(documents);
  } catch (e) {
    console.error('Error listing documents:', e);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

app.post('/api/documents', (req, res) => {
  try {
    const { id, title } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    getDoc(id);
    const metaPath = path.join(DATA_DIR, `${id}.json`);
    const meta = {
      id,
      title: title || 'Untitled Document',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    res.json(meta);
  } catch (e) {
    console.error('Error creating document:', e);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

app.get('/api/documents/:id', (req, res) => {
  try {
    const { id } = req.params;
    const metaPath = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    res.json(meta);
  } catch (e) {
    console.error('Error getting document:', e);
    res.status(500).json({ error: 'Failed to get document' });
  }
});

app.put('/api/documents/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    const metaPath = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.title = title || meta.title;
    meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    res.json(meta);
  } catch (e) {
    console.error('Error updating document:', e);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

app.delete('/api/documents/:id', (req, res) => {
  try {
    const { id } = req.params;
    const metaPath = path.join(DATA_DIR, `${id}.json`);
    const binPath = path.join(DATA_DIR, `${id}.bin`);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
    docs.delete(id);
    res.json({ success: true });
  } catch (e) {
    console.error('Error deleting document:', e);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const send = (conn, m) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    return;
  }
  try {
    conn.send(m, (err) => { err && console.error(err); });
  } catch (e) {
    console.error(e);
  }
};

wss.on('connection', (conn, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const docId = url.pathname.slice(1);

  if (!docId) {
    conn.close();
    return;
  }

  const { ydoc, awareness } = getDoc(docId);

  conn.binaryType = 'arraybuffer';

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, ydoc);
  send(conn, encoding.toUint8Array(encoder));

  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoderAwareness = encoding.createEncoder();
    encoding.writeVarUint(encoderAwareness, messageAwareness);
    encoding.writeVarUint8Array(
      encoderAwareness,
      awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys()))
    );
    send(conn, encoding.toUint8Array(encoderAwareness));
  }

  const onUpdate = (update, origin) => {
    if (origin === conn) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    send(conn, encoding.toUint8Array(encoder));
  };

  const onAwarenessUpdate = ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated).concat(removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
    );
    send(conn, encoding.toUint8Array(encoder));
  };

  ydoc.on('update', onUpdate);
  awareness.on('update', onAwarenessUpdate);

  const closeConn = () => {
    ydoc.off('update', onUpdate);
    awareness.off('update', onAwarenessUpdate);
  };

  conn.on('message', (message) => {
    try {
      const uint8Message = new Uint8Array(message);
      const decoder = decoding.createDecoder(uint8Message);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, ydoc, conn);
          if (encoding.length(encoder) > 1) {
            send(conn, encoding.toUint8Array(encoder));
          }
          break;
        }
        case messageAwareness: {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            conn
          );
          break;
        }
      }
    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  conn.on('close', closeConn);
});

wsServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready for Yjs connections`);
});
