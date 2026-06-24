import React from 'react';
import { useOutletContext } from 'react-router-dom';
import DoctorTab from '../components/DoctorTab';

export default function DrDashboard() {
    const { currentUser, allUsers, onNotificationsRead } = useOutletContext();

    if (!currentUser) return null;

    return (
        <div>
            <DoctorTab
                currentUser={currentUser}
                allUsers={allUsers}
                onNotificationsRead={onNotificationsRead}
            />
        </div>
    );
}
