import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import api from '../services/api';

const BountyDetail = () => {
  const { id } = useParams();
  const [bounty, setBounty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [newDeadline, setNewDeadline] = useState(new Date());
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState(null);
  const [extendSuccess, setExtendSuccess] = useState(false);

  useEffect(() => {
    fetchBounty();
  }, [id]);

  const fetchBounty = async () => {
    try {
      setLoading(true);
      const response = await api.getBounty(id);
      setBounty(response.data);
      setNewDeadline(new Date(response.data.deadlineAt));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExtendDeadline = async () => {
    try {
      setExtending(true);
      setExtendError(null);
      setExtendSuccess(false);

      const response = await api.extendDeadline(id, {
        maintainer: bounty.maintainer,
        newDeadline: newDeadline.toISOString()
      });

      setBounty(prev => ({
        ...prev,
        deadlineAt: response.data.bounty.deadlineAt
      }));
      setExtendSuccess(true);
      setShowExtendModal(false);
    } catch (err) {
      setExtendError(err.response?.data?.error || 'Failed to extend deadline');
    } finally {
      setExtending(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!bounty) return <div className="not-found">Bounty not found</div>;

  return (
    <div className="bounty-detail">
      <h1>{bounty.title}</h1>
      <p className="description">{bounty.description}</p>
      
      <div className="bounty-info">
        <p><strong>Reward:</strong> {bounty.reward} XLM</p>
        <p><strong>Deadline:</strong> {new Date(bounty.deadlineAt).toLocaleDateString()}</p>
        <p><strong>Status:</strong> {bounty.status}</p>
        <p><strong>Maintainer:</strong> {bounty.maintainer}</p>
      </div>

      {bounty.isMaintainer && (
        <div className="maintainer-actions">
          <button 
            onClick={() => setShowExtendModal(true)}
            className="btn btn-primary"
          >
            Extend Deadline
          </button>
        </div>
      )}

      {showExtendModal && (
        <div className="modal">
          <div className="modal-content">
            <h2>Extend Deadline</h2>
            <p>Current deadline: {new Date(bounty.deadlineAt).toLocaleDateString()}</p>
            
            <div className="form-group">
              <label>New Deadline:</label>
              <DatePicker
                selected={newDeadline}
                onChange={date => setNewDeadline(date)}
                minDate={new Date()}
                showTimeSelect
                dateFormat="Pp"
                className="form-control"
              />
            </div>

            {extendError && (
              <div className="alert alert-danger">{extendError}</div>
            )}

            {extendSuccess && (
              <div className="alert alert-success">Deadline extended successfully!</div>
            )}

            <div className="modal-actions">
              <button 
                onClick={handleExtendDeadline}
                disabled={extending}
                className="btn btn-primary"
              >
                {extending ? 'Extending...' : 'Confirm Extension'}
              </button>
              <button 
                onClick={() => setShowExtendModal(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BountyDetail;
