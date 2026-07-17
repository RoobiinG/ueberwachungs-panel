package de.roobiin.panel.ui.alerts

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.tabs.TabLayout
import de.roobiin.panel.databinding.FragmentAlertsBinding
import de.roobiin.panel.viewmodel.AlertsViewModel

class AlertsFragment : Fragment() {

    private var _binding: FragmentAlertsBinding? = null
    private val binding get() = _binding!!
    private val vm: AlertsViewModel by viewModels()

    private lateinit var rulesAdapter: AlertRulesAdapter
    private lateinit var historyAdapter: AlertHistoryAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentAlertsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        rulesAdapter = AlertRulesAdapter(
            onToggle = { id, enabled -> vm.toggleRule(id, enabled) },
            onTest = { id -> vm.testRule(id) }
        )
        historyAdapter = AlertHistoryAdapter()

        binding.recyclerView.layoutManager = LinearLayoutManager(requireContext())
        binding.recyclerView.adapter = rulesAdapter

        binding.tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                when (tab.position) {
                    0 -> {
                        binding.recyclerView.adapter = rulesAdapter
                        vm.rules.value?.let { rulesAdapter.submitList(it) }
                    }
                    1 -> {
                        binding.recyclerView.adapter = historyAdapter
                        vm.history.value?.let { historyAdapter.submitList(it) }
                    }
                }
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })

        binding.swipeRefresh.setOnRefreshListener { vm.load() }

        vm.loading.observe(viewLifecycleOwner) { binding.swipeRefresh.isRefreshing = it }
        vm.error.observe(viewLifecycleOwner) { err ->
            err?.let { Snackbar.make(binding.root, it, Snackbar.LENGTH_LONG).show() }
        }
        vm.rules.observe(viewLifecycleOwner) { rules ->
            if (binding.tabLayout.selectedTabPosition == 0) rulesAdapter.submitList(rules)
        }
        vm.history.observe(viewLifecycleOwner) { history ->
            if (binding.tabLayout.selectedTabPosition == 1) historyAdapter.submitList(history)
        }
        vm.testResult.observe(viewLifecycleOwner) { msg ->
            msg?.let {
                Snackbar.make(binding.root, it, Snackbar.LENGTH_SHORT).show()
                vm.clearTestResult()
            }
        }

        vm.load()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
