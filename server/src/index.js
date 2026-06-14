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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

const docs = new Map();
const wsServer = createServer(app);
const wss = new WebSocketServer({ server: wsServer });

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;

function getDoc(docId) {
  if (docs.has(docId)) {
    return docs.get(docId);
  }

  const ydoc = new Y.Doc();
  const filePath = path.join(DATA_DIR, `${docId}.bin`);
  const contentArray = ydoc.getArray('content');

  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath);
      Y.applyUpdate(ydoc, new Uint8Array(data));
      console.log(`[Doc ${docId}] Loaded from disk, size=${data.length} bytes, content.length=${contentArray.length}`);
    } catch (e) {
      console.error(`[Doc ${docId}] Error loading document:`, e);
    }
  } else {
    console.log(`[Doc ${docId}] Created new document (empty)`);
  }

  const awareness = new awarenessProtocol.Awareness(ydoc);

  let saveTimeout = null;
  ydoc.on('update', (update, origin) => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      try {
        const state = Y.encodeStateAsUpdate(ydoc);
        fs.writeFileSync(filePath, Buffer.from(state));
        console.log(`[Doc ${docId}] Saved (${state.length} bytes). Conns: ${getConnCount(docId)}`);
      } catch (e) {
        console.error(`[Doc ${docId}] Error saving:`, e);
      }
    }, 1000);
  });

  const connSet = new Set();
  const doc = { ydoc, awareness, filePath, connSet };
  docs.set(docId, doc);
  return doc;
}

function getConnCount(docId) {
  const doc = docs.get(docId);
  return doc ? doc.connSet.size : 0;
}

app.get('/api/documents', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const documents = files.map(file => {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
        return {
          id: file.replace('.json', ''),
          title: content.title || 'Untitled',
          updatedAt: content.updatedAt || null
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
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
    console.log(`[API] Created document: ${id} (${meta.title})`);
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
    console.log(`[API] Deleted document: ${id}`);
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
    conn.send(m, (err) => { if (err) console.error('[WS] Send error:', err.message); });
  } catch (e) {
    console.error('[WS] Send exception:', e);
  }
};

wss.on('connection', (conn, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const docId = url.pathname.replace(/^\//, '');

    if (!docId) {
      console.log('[WS] Rejected: No docId in URL path');
      conn.close();
      return;
    }

    const { ydoc, awareness, connSet } = getDoc(docId);
    connSet.add(conn);

    console.log(`[WS] Client connected. Doc=${docId}. Clients=${connSet.size}`);

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
      connSet.delete(conn);

      try {
        awarenessProtocol.removeAwarenessStates(awareness, [conn.clientId || 0], conn);
      } catch (e) {}

      console.log(`[WS] Client disconnected. Doc=${docId}. Clients left=${connSet.size}`);

      if (connSet.size === 0) {
        try {
          const state = Y.encodeStateAsUpdate(ydoc);
          const filePath = path.join(DATA_DIR, `${docId}.bin`);
          fs.writeFileSync(filePath, Buffer.from(state));
          console.log(`[Doc ${docId}] Final save on empty.`);
        } catch (e) {}
      }
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
            const awarenessUpdate = decoding.readVarUint8Array(decoder);
            awarenessProtocol.applyAwarenessUpdate(
              awareness,
              awarenessUpdate,
              conn
            );
            break;
          }
          case messageQueryAwareness: {
            const encoderAwareness = encoding.createEncoder();
            encoding.writeVarUint(encoderAwareness, messageAwareness);
            encoding.writeVarUint8Array(
              encoderAwareness,
              awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()))
            );
            send(conn, encoding.toUint8Array(encoderAwareness));
            break;
          }
          default:
            console.warn(`[WS] Unknown message type: ${messageType}`);
        }
      } catch (e) {
        console.error('[WS] Error handling message:', e);
      }
    });

    conn.on('error', (err) => {
      console.error('[WS] Connection error:', err.message);
    });

    conn.on('close', closeConn);
  } catch (e) {
    console.error('[WS] Error on connection:', e);
    try { conn.close(); } catch (_) {}
  }
});

wsServer.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Collaborative Editor Server Started`);
  console.log(`   HTTP/API:      http://localhost:${PORT}`);
  console.log(`   WebSocket/Yjs: ws://localhost:${PORT}/<docId>`);
  console.log(`   Data dir:      ${DATA_DIR}`);
  console.log(`========================================\n`);
});
