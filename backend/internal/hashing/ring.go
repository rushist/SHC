package hashing

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"sort"
	"strconv"
	"sync"
)

var (
	ErrNoNodesInRing = errors.New("hash ring is empty: no nodes available")
)

// HashFunc defines the hashing algorithm used to map keys and vnodes onto the ring.
type HashFunc func(data []byte) uint32

// DefaultHashFunc uses SHA-256 truncated to uint32 for uniform distribution.
func DefaultHashFunc(data []byte) uint32 {
	h := sha256.Sum256(data)
	return binary.BigEndian.Uint32(h[:4])
}

// NodeTarget represents a physical node's identifier and network address.
type NodeTarget struct {
	NodeID string `json:"node_id"`
	Addr   string `json:"addr"`
}

// VNodeInfo represents a virtual node's placement on the ring.
type VNodeInfo struct {
	Hash   uint32 `json:"hash"`
	NodeID string `json:"node_id"`
	VNode  int    `json:"vnode_index"`
}

// RingTopology exposes the complete ring layout for visualization and debugging.
type RingTopology struct {
	TotalVNodes int          `json:"total_vnodes"`
	Nodes       []NodeTarget `json:"nodes"`
	VNodes      []VNodeInfo  `json:"vnodes"`
}

// HashRing represents a thread-safe consistent hash ring with virtual nodes.
type HashRing struct {
	mu            sync.RWMutex
	vnodes        int               // Number of virtual nodes per physical node
	hashFunc      HashFunc          // Hashing function
	ring          []uint32          // Sorted virtual node token hashes
	vnodeToNode   map[uint32]string // Token Hash -> Physical Node ID
	nodeAddresses map[string]string // Physical Node ID -> Network Address
	nodes         map[string]bool   // Set of registered physical node IDs
}

// New creates a new HashRing with the given virtual node replication count.
func New(vnodes int, hashFunc HashFunc) *HashRing {
	if vnodes <= 0 {
		vnodes = 50 // Standard default for balanced partition distribution
	}
	if hashFunc == nil {
		hashFunc = DefaultHashFunc
	}

	return &HashRing{
		vnodes:        vnodes,
		hashFunc:      hashFunc,
		ring:          make([]uint32, 0),
		vnodeToNode:   make(map[uint32]string),
		nodeAddresses: make(map[string]string),
		nodes:         make(map[string]bool),
	}
}

// AddNode adds a physical node and its virtual nodes to the hash ring.
func (h *HashRing) AddNode(nodeID, addr string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// If a placeholder entry with nodeID == addr exists, remove it first
	if nodeID != addr && h.nodes[addr] {
		h.internalRemoveNode(addr)
	}

	if h.nodes[nodeID] {
		h.nodeAddresses[nodeID] = addr
		return
	}

	h.nodes[nodeID] = true
	h.nodeAddresses[nodeID] = addr

	for i := 0; i < h.vnodes; i++ {
		vnodeKey := nodeID + "#vnode:" + strconv.Itoa(i)
		hash := h.hashFunc([]byte(vnodeKey))

		h.ring = append(h.ring, hash)
		h.vnodeToNode[hash] = nodeID
	}

	sort.Slice(h.ring, func(i, j int) bool {
		return h.ring[i] < h.ring[j]
	})
}

// RemoveNode removes a physical node and all its virtual nodes from the hash ring.
func (h *HashRing) RemoveNode(nodeID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.internalRemoveNode(nodeID)
}

func (h *HashRing) internalRemoveNode(nodeID string) {
	if !h.nodes[nodeID] {
		return
	}

	delete(h.nodes, nodeID)
	delete(h.nodeAddresses, nodeID)

	newRing := make([]uint32, 0, len(h.ring)-h.vnodes)
	for _, hash := range h.ring {
		if h.vnodeToNode[hash] == nodeID {
			delete(h.vnodeToNode, hash)
		} else {
			newRing = append(newRing, hash)
		}
	}
	h.ring = newRing
}

// GetPrimaryNode returns the physical node responsible for the given key.
func (h *HashRing) GetPrimaryNode(key string) (NodeTarget, uint32, error) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if len(h.ring) == 0 {
		return NodeTarget{}, 0, ErrNoNodesInRing
	}

	keyHash := h.hashFunc([]byte(key))

	idx := sort.Search(len(h.ring), func(i int) bool {
		return h.ring[i] >= keyHash
	})

	if idx == len(h.ring) {
		idx = 0
	}

	vnodeHash := h.ring[idx]
	nodeID := h.vnodeToNode[vnodeHash]
	addr := h.nodeAddresses[nodeID]

	return NodeTarget{
		NodeID: nodeID,
		Addr:   addr,
	}, keyHash, nil
}

// GetNodes returns up to 'count' distinct physical nodes following the key along the ring.
func (h *HashRing) GetNodes(key string, count int) ([]NodeTarget, error) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if len(h.ring) == 0 {
		return nil, ErrNoNodesInRing
	}

	keyHash := h.hashFunc([]byte(key))
	idx := sort.Search(len(h.ring), func(i int) bool {
		return h.ring[i] >= keyHash
	})

	if idx == len(h.ring) {
		idx = 0
	}

	uniqueNodes := make([]NodeTarget, 0, count)
	seen := make(map[string]bool)

	for i := 0; i < len(h.ring) && len(uniqueNodes) < count; i++ {
		curIdx := (idx + i) % len(h.ring)
		vnodeHash := h.ring[curIdx]
		nodeID := h.vnodeToNode[vnodeHash]

		if !seen[nodeID] {
			seen[nodeID] = true
			uniqueNodes = append(uniqueNodes, NodeTarget{
				NodeID: nodeID,
				Addr:   h.nodeAddresses[nodeID],
			})
		}
	}

	return uniqueNodes, nil
}

// GetTopology returns a snapshot of the ring layout.
func (h *HashRing) GetTopology() RingTopology {
	h.mu.RLock()
	defer h.mu.RUnlock()

	nodes := make([]NodeTarget, 0, len(h.nodes))
	for nodeID := range h.nodes {
		nodes = append(nodes, NodeTarget{
			NodeID: nodeID,
			Addr:   h.nodeAddresses[nodeID],
		})
	}

	vnodes := make([]VNodeInfo, 0, len(h.ring))
	for _, hash := range h.ring {
		vnodes = append(vnodes, VNodeInfo{
			Hash:   hash,
			NodeID: h.vnodeToNode[hash],
		})
	}

	return RingTopology{
		TotalVNodes: len(h.ring),
		Nodes:       nodes,
		VNodes:      vnodes,
	}
}

// HashKey calculates the 32-bit hash value for a given key.
func (h *HashRing) HashKey(key string) uint32 {
	return h.hashFunc([]byte(key))
}

// NodeCount returns the number of physical nodes currently registered.
func (h *HashRing) NodeCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.nodes)
}
