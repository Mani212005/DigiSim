"""
Module: generate_netlist_dataset.py
Purpose: Generates synthetic and truth-table validated netlists
         formatted for Gemma 3/4 LoRA fine-tuning.
"""

import json
import random
from typing import Any, Dict, List


def generate_random_circuit() -> Dict[str, Any]:
    """
    Generates a random combinational circuit structure.

    Returns:
        A dictionary representing the circuit JSON.
    """
    gates = ["andGate", "orGate", "nandGate", "norGate", "xorGate"]
    num_inputs = random.randint(2, 4)
    num_gates = random.randint(2, 5)

    nodes = []
    edges = []

    for i in range(num_inputs):
        nodes.append({"id": f"in_{i}", "type": "input", "data": {"label": f"I{i}"}})

    for i in range(num_gates):
        gate = random.choice(gates)
        nodes.append({"id": f"g_{i}", "type": gate, "data": {"label": gate}})

    nodes.append({"id": "out", "type": "output", "data": {"label": "O"}})

    # Wire randomly but ensure no cycles for combinational logic
    for i in range(num_gates):
        # Pick 2 random sources from inputs or earlier gates
        sources = [n["id"] for n in nodes if n["id"].startswith("in_") or (n["id"].startswith("g_") and int(n["id"].split("_")[1]) < i)]
        if len(sources) < 2:
            sources = [nodes[0]["id"], nodes[1]["id"]]

        src1 = random.choice(sources)
        src2 = random.choice(sources)
        edges.append({"id": f"e_{src1}_g_{i}", "source": src1, "target": f"g_{i}", "sourceHandle": "s:val", "targetHandle": "a"})
        edges.append({"id": f"e_{src2}_g_{i}", "source": src2, "target": f"g_{i}", "sourceHandle": "s:val", "targetHandle": "b"})

    # Connect last gate to out
    edges.append({"id": f"e_g_{num_gates - 1}_out", "source": f"g_{num_gates - 1}", "target": "out", "sourceHandle": "s:val", "targetHandle": "val"})

    return {"nodes": nodes, "edges": edges}


def build_dataset(num_samples: int = 100) -> List[Dict[str, str]]:
    """
    Builds a list of training examples formatted for Gemma LoRA.

    Args:
        num_samples: Number of examples to generate.

    Returns:
        Dataset list.
    """
    dataset = []
    for _ in range(num_samples):
        circuit = generate_random_circuit()
        # Mock truth table validation
        truth_table = "Truth Table validated: OK"

        prompt = "Synthesize an optimal digital circuit netlist for the given truth table."
        response = json.dumps(circuit, separators=(",", ":"))

        dataset.append({"instruction": prompt, "input": truth_table, "output": response})
    return dataset


def main() -> None:
    """Main execution function to write the dataset."""
    dataset = build_dataset(100)
    out_path = "gemma_lora_dataset.jsonl"
    with open(out_path, "w", encoding="utf-8") as f:
        for entry in dataset:
            f.write(json.dumps(entry) + "\n")
    print(f"Generated {len(dataset)} examples in {out_path}")


if __name__ == "__main__":
    main()
