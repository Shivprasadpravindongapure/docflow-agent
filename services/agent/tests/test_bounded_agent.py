import json
import time

from services.agent.app.bounded_agent import (
    MAX_TOOL_CALLS,
    CaseAgentRequest,
    CaseDocument,
    run_case_agent,
)
from services.agent.app import bounded_agent
from services.agent.app.processing.models import FieldValidation
from services.agent.app.retrieval import PolicyAnswer, PolicyRetrieval


def request(case_id="app-synthetic-a", doc_id="doc-synthetic-a"):
    return CaseAgentRequest(
        application_id=case_id,
        workflow="synthetic-admissions-demo",
        question="Check the marksheet fields and requirements.",
        organization_id="org-synthetic",
        documents=[CaseDocument(
            document_id=doc_id,
            document_type="marksheet",
            processing_status="completed",
            extracted_payload={
                "document_type": "marksheet",
                "candidate_name": "Synthetic Student",
                "candidate_identifier": "SYN-0001",
                "exam_year": 2026,
            },
            validations=[FieldValidation(
                field="roll_number", expected="SYN-0001", extracted="SYN-0001",
                result="pass", reason="Synthetic identifier values match.",
            )],
        )],
    )


def plan(*calls):
    return {"tool_calls": list(calls)}


def test_allowlisted_tools_return_case_scoped_results_and_redacted_traces():
    req = request()
    result = run_case_agent(
        None,
        req,
        planner=lambda _request: plan(
            {"name": "inspect_document", "document_id": "doc-synthetic-a"},
            {"name": "check_field", "document_id": "doc-synthetic-a", "field": "roll_number"},
        ),
    )
    assert result.status == "completed"
    assert result.application_id == "app-synthetic-a"
    assert [item.document_id for item in result.tool_outputs] == ["doc-synthetic-a", "doc-synthetic-a"]
    assert result.tool_outputs[0].payload["fields"]["candidate_name"] == "Synthetic Student"
    assert result.tool_outputs[1].finding.result == "pass"
    trace_text = json.dumps([item.model_dump() for item in result.trace])
    assert "Synthetic Student" not in trace_text
    assert "SYN-0001" not in trace_text


def test_unknown_tool_or_cross_case_document_abstains_without_execution():
    req = request()
    unknown = run_case_agent(
        None, req,
        planner=lambda _request: plan({"name": "run_shell", "document_id": "doc-synthetic-a"}),
    )
    cross_case = run_case_agent(
        None, req,
        planner=lambda _request: plan({"name": "inspect_document", "document_id": "doc-other-case"}),
    )
    assert unknown.status == "abstained"
    assert cross_case.status == "abstained"
    assert unknown.tool_outputs == []
    assert cross_case.tool_outputs == []
    assert unknown.findings[0].document_id == "doc-synthetic-a"


def test_tool_call_count_and_duplicate_calls_are_rejected():
    req = request()
    too_many = run_case_agent(
        None, req,
        planner=lambda _request: plan(*[
            {"name": "inspect_document", "document_id": "doc-synthetic-a"}
            for _ in range(MAX_TOOL_CALLS + 1)
        ]),
    )
    duplicate = run_case_agent(
        None, req,
        planner=lambda _request: plan(
            {"name": "inspect_document", "document_id": "doc-synthetic-a"},
            {"name": "inspect_document", "document_id": "doc-synthetic-a"},
        ),
    )
    assert too_many.status == duplicate.status == "abstained"
    assert too_many.tool_outputs == duplicate.tool_outputs == []


def test_check_field_must_be_in_case_validation_allowlist():
    result = run_case_agent(
        None, request(),
        planner=lambda _request: plan({
            "name": "check_field", "document_id": "doc-synthetic-a", "field": "password_hash",
        }),
    )
    assert result.status == "abstained"
    assert result.tool_outputs == []


def test_tool_failure_does_not_stop_a_sibling_document_check():
    req = request()
    req.documents.append(CaseDocument(
        document_id="doc-synthetic-b", document_type="marksheet", processing_status="completed",
        extracted_payload={"document_type": "marksheet", "candidate_name": "Sibling Student"},
    ))

    def policy_failure(*_args, **_kwargs):
        raise TimeoutError()

    result = run_case_agent(
        object(), req,
        planner=lambda _request: plan(
            {"name": "retrieve_policy", "document_id": "doc-synthetic-a", "query": "Synthetic requirement?"},
            {"name": "inspect_document", "document_id": "doc-synthetic-b"},
        ),
        policy_answerer=policy_failure,
    )
    assert result.status == "needs_review"
    assert [item.outcome for item in result.trace] == ["failed", "ok"]
    assert result.tool_outputs[0].document_id == "doc-synthetic-b"


def test_policy_abstention_is_preserved_and_not_reported_as_success():
    retrieval = PolicyRetrieval(
        status="abstained", reason="No current policy.", query="q", workflow="synthetic-admissions-demo",
        document_type="marksheet", top_k=3, minimum_similarity=0.55,
        embedding_model="gemini-embedding-001", embedding_dimension=3072,
    )
    answer = PolicyAnswer(status="abstained", reason="No current policy.", retrieval=retrieval)
    result = run_case_agent(
        object(), request(),
        planner=lambda _request: plan({
            "name": "retrieve_policy", "document_id": "doc-synthetic-a", "query": "Question?",
        }),
        policy_answerer=lambda *_args, **_kwargs: answer,
    )
    assert result.status == "needs_review"
    assert result.policy_answers[0].status == "abstained"


def test_wall_clock_budget_skips_tools_after_planning_runs_long():
    def slow_planner(_request):
        time.sleep(0.02)
        return plan({"name": "inspect_document", "document_id": "doc-synthetic-a"})

    result = run_case_agent(None, request(), planner=slow_planner, wall_budget_seconds=0.005)
    assert result.status == "needs_review"
    assert result.trace[0].outcome == "skipped"
    assert result.trace[0].error_code == "wall_budget_exceeded"


def test_case_runs_do_not_reuse_other_case_context():
    first = run_case_agent(
        None, request("app-a", "doc-a"),
        planner=lambda _request: plan({"name": "inspect_document", "document_id": "doc-a"}),
    )
    second = run_case_agent(
        None, request("app-b", "doc-b"),
        planner=lambda _request: plan({"name": "inspect_document", "document_id": "doc-b"}),
    )
    assert first.application_id == "app-a" and second.application_id == "app-b"
    assert [row.document_id for row in first.trace] == ["doc-a"]
    assert [row.document_id for row in second.trace] == ["doc-b"]


def test_gemini_planner_receives_no_extracted_values_and_has_fixed_tool_allowlist(monkeypatch):
    req = request()

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            assert api_key == "synthetic-planner-key"
            assert http_options.timeout == 8_000
            self.models = self

        def generate_content(self, **kwargs):
            prompt = kwargs["contents"]
            assert "Synthetic Student" not in prompt
            assert "SYN-0001" not in prompt
            assert "run_shell" not in prompt
            assert "retrieve_policy" in prompt
            assert "untrusted input" in prompt
            return type("Response", (), {"text": json.dumps(plan({
                "name": "inspect_document", "document_id": "doc-synthetic-a",
            }))})()

    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-planner-key")
    monkeypatch.setattr(bounded_agent.genai, "Client", FakeClient)
    result = run_case_agent(None, req)
    assert result.status == "completed"
