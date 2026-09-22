"""
Module: digisim_env.py
Purpose: Gymnasium environment for automated logic minimization and delay reduction.
"""

import gymnasium as gym
import numpy as np
from gymnasium import spaces
from gymnasium.envs.registration import register


class DigiSimEnv(gym.Env):
    """
    DigiSim RL Environment for logic minimization and delay reduction.
    """

    metadata = {"render_modes": ["human"]}

    def __init__(self, render_mode=None):
        self.render_mode = render_mode

        # State space: circuit graph adjacency matrix (up to 100 nodes),
        # gate types (up to 100), propagation delays.
        self.max_nodes = 100
        self.observation_space = spaces.Dict(
            {
                "adjacency": spaces.Box(low=0, high=1, shape=(self.max_nodes, self.max_nodes), dtype=np.int8),
                "gate_types": spaces.MultiDiscrete([10] * self.max_nodes),
                "delays": spaces.Box(low=0.0, high=10.0, shape=(self.max_nodes,), dtype=np.float32),
            }
        )

        # Action space:
        # 0: gate substitution, 1: transistor resizing, 2: wire re-routing
        # Plus node indices and targets.
        self.action_space = spaces.MultiDiscrete([3, self.max_nodes, self.max_nodes, 10])

        # Weights for reward
        self.alpha = 1.0  # t_pd weight
        self.beta = 0.5  # GateCount weight
        self.gamma = 0.1  # Power weight

        self._reset_circuit()

    def _reset_circuit(self):
        self.adj = np.zeros((self.max_nodes, self.max_nodes), dtype=np.int8)
        self.gates = np.zeros((self.max_nodes,), dtype=np.int8)
        self.delays = np.zeros((self.max_nodes,), dtype=np.float32)
        self.step_count = 0

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self._reset_circuit()
        obs = {"adjacency": self.adj, "gate_types": self.gates, "delays": self.delays}
        return obs, {}

    def step(self, action):
        self.step_count += 1

        # Dummy action application
        action_type, node1, node2, param = action
        if action_type == 0:
            self.gates[node1] = param
        elif action_type == 1:
            self.delays[node1] = max(0.1, self.delays[node1] - 0.1)
        elif action_type == 2:
            self.adj[node1, node2] = 1

        t_pd = float(np.sum(self.delays))
        gate_count = int(np.count_nonzero(self.gates))
        power = float(gate_count * 2.5)

        # Reward function: R = -alpha * t_pd - beta * GateCount - gamma * Power
        reward = -(self.alpha * t_pd) - (self.beta * gate_count) - (self.gamma * power)

        terminated = self.step_count >= 100
        truncated = False

        obs = {"adjacency": self.adj, "gate_types": self.gates, "delays": self.delays}
        return obs, float(reward), terminated, truncated, {}

    def render(self):
        if self.render_mode == "human":
            print(f"Step: {self.step_count} | Gates: {np.count_nonzero(self.gates)}")


# Register the environment
register(
    id="DigiSim-RL-v1",
    entry_point="ml.rl.digisim_env:DigiSimEnv",
    max_episode_steps=100,
)
