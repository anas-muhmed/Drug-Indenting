import React from 'react';
import { useOutletContext } from 'react-router-dom';
import HODTab from '../components/HODTab';

export default function HODDashboard() {
    const { currentUser, allUsers, onNotificationsRead } = useOutletContext();

    if (!currentUser) return null;

    return (
        <div>
            <HODTab
                currentUser={currentUser}
                allUsers={allUsers}
                onNotificationsRead={onNotificationsRead}
            />
        </div>
    );
}
