import React from 'react';

interface User {
  id: string;
  name: string;
  color: string;
}

interface AwarenessUser {
  clientId: number;
  user: User;
  cursor?: any;
}

interface UsersListProps {
  users: AwarenessUser[];
  currentUserId: string;
}

const UsersList: React.FC<UsersListProps> = ({ users, currentUserId }) => {
  return (
    <div className="users-list">
      <h3 className="users-title">
        在线用户 ({users.length})
      </h3>
      <div className="users-scroll">
        {users.map(({ user }) => (
          <div
            key={user.id + user.name}
            className={`user-item ${user.id === currentUserId ? 'current-user' : ''}`}
          >
            <span
              className="user-avatar"
              style={{ backgroundColor: user.color }}
            >
              {user.name.charAt(0)}
            </span>
            <div className="user-details">
              <span className="user-item-name">{user.name}</span>
              {user.id === currentUserId && (
                <span className="user-badge">我</span>
              )}
            </div>
            <span
              className="user-color-indicator"
              style={{ backgroundColor: user.color }}
            ></span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default UsersList;
