import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = {
  // Existing API methods...

  getBounty: async (id) => {
    return axios.get(`${API_BASE_URL}/bounties/${id}`);
  },

  createBounty: async (data) => {
    return axios.post(`${API_BASE_URL}/bounties`, data);
  },

  updateBounty: async (id, data) => {
    return axios.put(`${API_BASE_URL}/bounties/${id}`, data);
  },

  deleteBounty: async (id) => {
    return axios.delete(`${API_BASE_URL}/bounties/${id}`);
  },

  // New extend deadline method
  extendDeadline: async (id, data) => {
    return axios.post(`${API_BASE_URL}/bounties/${id}/extend-deadline`, data);
  }
};

export default api;
