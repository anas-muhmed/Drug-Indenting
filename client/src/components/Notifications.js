// =====================================================================
// Notifications.js — In-app notification panel
// =====================================================================
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function Notifications({ userId, onRead }) {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    axios.get(`${API}/notifications/${userId}`)
      .then(r => setNotifs(r.data))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    try {
      await axios.put(`${API}/notifications/${id}/read`);
      setNotifs(prev => prev.map(n =>
        n.NOTIFICATION_ID === id ? { ...n, IS_READ: 1 } : n
      ));
      if (onRead) onRead();
    } catch { }
  };

  const markAllRead = async () => {
    const unread = notifs.filter(n => !n.IS_READ);
    await Promise.all(unread.map(n => axios.put(`${API}/notifications/${n.NOTIFICATION_ID}/read`).catch(() => { })));
    setNotifs(prev => prev.map(n => ({ ...n, IS_READ: 1 })));
    if (onRead) onRead();
  };

  const unreadCount = notifs.filter(n => !n.IS_READ).length;

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-title" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="icon">🔔</div>
          Notifications
          {unreadCount > 0 && (
            <span className="tab-badge">{unreadCount} new</span>
          )}
        </div>
        {unreadCount > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
          <div className="spinner" />
        </div>
      ) : notifs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
          🎉 You're all caught up! No notifications.
        </div>
      ) : (
        <div className="notif-panel">
          {notifs.map(n => (
            <div
              key={n.NOTIFICATION_ID}
              className={`notif-item ${!n.IS_READ ? 'unread' : ''}`}
              onClick={() => !n.IS_READ && markRead(n.NOTIFICATION_ID)}
            >
              <div className="notif-dot" style={{ opacity: n.IS_READ ? 0 : 1 }} />
              <div style={{ flex: 1 }}>
                <div className="notif-msg">{n.MESSAGE}</div>
                <div className="notif-time">{timeAgo(n.CREATED_AT)}</div>
              </div>
              {!n.IS_READ && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.7rem', padding: '4px 8px', flexShrink: 0 }}
                  onClick={(e) => { e.stopPropagation(); markRead(n.NOTIFICATION_ID); }}
                >
                  ✓
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
