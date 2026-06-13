import React from 'react';

interface Notification {
  id: string;
  message: string;
  type: 'join' | 'leave';
  timestamp: number;
}

interface NotificationsProps {
  notifications: Notification[];
}

const Notifications: React.FC<NotificationsProps> = ({ notifications }) => {
  return (
    <div className="notifications-container">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`notification ${notification.type}`}
        >
          <span className="notification-icon">
            {notification.type === 'join' ? '➕' : '➖'}
          </span>
          <span className="notification-message">{notification.message}</span>
        </div>
      ))}
    </div>
  );
};

export default Notifications;
