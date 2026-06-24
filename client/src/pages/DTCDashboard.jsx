import React from 'react';
import { useOutletContext } from 'react-router-dom';
import DTCCommitteeTab from '../components/DTCCommitteeTab';

export default function DTCDashboard() {
    const { currentUser, allUsers, onNotificationsRead } = useOutletContext();

    if (!currentUser) return null;

    return (
        <div>
            <DTCCommitteeTab
                currentUser={currentUser}
                allUsers={allUsers}
                onNotificationsRead={onNotificationsRead}
            />
        </div>
    );
}
