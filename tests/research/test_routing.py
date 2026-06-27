"""Unit tests for the deep-research routing heuristics.

No I/O, no live calls, no marks required.
"""

from app.research.routing import explicit_deep_research, looks_like_research


class TestExplicitDeepResearch:
    def test_deep_research_phrase(self) -> None:
        assert explicit_deep_research("Give me a deep research report on MIT")

    def test_sourced_report_phrase(self) -> None:
        assert explicit_deep_research("I want a sourced report on financial aid")

    def test_comprehensive_comparison_phrase(self) -> None:
        assert explicit_deep_research("Give me a comprehensive comparison of Georgia Tech and CMU")

    def test_application_strategy_report_phrase(self) -> None:
        assert explicit_deep_research("I need an application strategy report")

    def test_case_insensitive(self) -> None:
        assert explicit_deep_research("DEEP RESEARCH on Stanford")

    def test_no_phrase(self) -> None:
        assert not explicit_deep_research("What is the acceptance rate at MIT?")

    def test_simple_question(self) -> None:
        assert not explicit_deep_research("Tell me about Harvard")


class TestLooksLikeResearch:
    def test_comparison_with_two_schools(self) -> None:
        assert looks_like_research(
            "compare Georgia Tech vs CMU for international CS students who need aid"
        )

    def test_financial_aid_strategy(self) -> None:
        assert looks_like_research(
            "What's the financial aid strategy between Stanford and MIT for international students"
        )

    def test_simple_factual_question(self) -> None:
        assert not looks_like_research("What is the acceptance rate at MIT?")

    def test_single_school_simple(self) -> None:
        assert not looks_like_research("Tell me about Harvard's programs")

    def test_multi_entity_with_connector(self) -> None:
        assert looks_like_research(
            "What are the differences between Carnegie Mellon and Georgia Tech for CS"
        )

    def test_ambiguous_routes_to_agent(self) -> None:
        # No connector or comparison word — routes to agent
        assert not looks_like_research("Stanford acceptance rate for international students")

    def test_versus_keyword(self) -> None:
        assert looks_like_research(
            "Northwestern versus Notre Dame scholarship requirements for international students"
        )
