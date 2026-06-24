import React from 'react';
import { useOutletContext } from 'react-router-dom';
import PharmacistTab from '../components/PharmacistTab';

export default function PharmacistDashboard() {
    const { currentUser, allUsers, onNotificationsRead } = useOutletContext();

    if (!currentUser) return null;

    return (
        <div>
            <PharmacistTab
                currentUser={currentUser}
                allUsers={allUsers}
                onNotificationsRead={onNotificationsRead}
            />
        </div>
    );
}
