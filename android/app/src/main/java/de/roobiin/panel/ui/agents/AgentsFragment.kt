package de.roobiin.panel.ui.agents

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import de.roobiin.panel.R
import de.roobiin.panel.databinding.FragmentAgentsBinding
import de.roobiin.panel.viewmodel.AgentsViewModel

class AgentsFragment : Fragment() {

    private var _binding: FragmentAgentsBinding? = null
    private val binding get() = _binding!!
    private val vm: AgentsViewModel by viewModels()
    private lateinit var adapter: AgentsAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentAgentsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        adapter = AgentsAdapter { agent ->
            val bundle = Bundle().apply { putInt("agentId", agent.id) }
            findNavController().navigate(R.id.action_agents_to_agentDetail, bundle)
        }
        binding.recyclerView.layoutManager = LinearLayoutManager(requireContext())
        binding.recyclerView.adapter = adapter

        binding.swipeRefresh.setOnRefreshListener { vm.loadAgents() }

        vm.loading.observe(viewLifecycleOwner) { binding.swipeRefresh.isRefreshing = it }
        vm.error.observe(viewLifecycleOwner) { err ->
            binding.tvError.text = err ?: ""
            binding.tvError.visibility = if (err != null) View.VISIBLE else View.GONE
        }
        vm.agents.observe(viewLifecycleOwner) { agents ->
            adapter.submitList(agents)
            binding.tvEmpty.visibility = if (agents.isEmpty()) View.VISIBLE else View.GONE
        }

        vm.loadAgents()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
