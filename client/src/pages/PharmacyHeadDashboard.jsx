import React from 'react';
import { useOutletContext } from 'react-router-dom';
import PharmacyHeadTab from '../components/PharmacyHeadTab';

export default function PharmacyHeadDashboard() {
    const { currentUser, allUsers, onNotificationsRead } = useOutletContext();

    if (!currentUser) return null;

    return (
        <div>
            <PharmacyHeadTab
                currentUser={currentUser}
                allUsers={allUsers}
                onNotificationsRead={onNotificationsRead}
            />
        </div>
    );
}
