import React from 'react';
import { useOutletContext } from 'react-router-dom';
import CEOTab from '../components/CEOTab';

export default function CEODashboard() {
    const { currentUser, allUsers, onNotificationsRead } = useOutletContext();

    if (!currentUser) return null;

    return (
        <div>
            <CEOTab
                currentUser={currentUser}
                allUsers={allUsers}
                onNotificationsRead={onNotificationsRead}
            />
        </div>
    );
}
