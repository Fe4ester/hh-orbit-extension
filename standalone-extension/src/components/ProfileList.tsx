import React from 'react';
import { Profile } from '../state/types';

interface ProfileListProps {
  profiles: Profile[];
  activeProfileId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCreate: () => void;
}

export const ProfileList: React.FC<ProfileListProps> = ({
  profiles,
  activeProfileId,
  onSelect,
  onEdit,
  onDelete,
  onDuplicate,
  onCreate,
}) => {
  return (
    <div className="profile-list">
      <div className="profile-list-header">
        <h3>Профили</h3>
        <button className="btn btn-primary" onClick={onCreate}>
          Создать профиль
        </button>
      </div>

      <div className="profiles">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className={`profile-item ${profile.id === activeProfileId ? 'active' : ''}`}
          >
            <div className="profile-info" onClick={() => onSelect(profile.id)}>
              <div className="profile-name">
                {profile.name}
                {profile.id === activeProfileId && <span className="active-badge">Активный</span>}
              </div>
              <div className="profile-meta">
                Создан: {new Date(profile.createdAt).toLocaleDateString()}
              </div>
            </div>

            <div className="profile-actions">
              <button className="btn-icon" onClick={() => onEdit(profile.id)} title="Редактировать">
                ✏️
              </button>
              <button className="btn-icon" onClick={() => onDuplicate(profile.id)} title="Дублировать">
                📋
              </button>
              <button
                className="btn-icon"
                onClick={() => onDelete(profile.id)}
                title="Удалить"
                disabled={profiles.length === 1}
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
