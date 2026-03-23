from memory_agent import main


def test_main_without_args_prints_help(capsys):
    legacy_cli = "notes" + "-agent"
    exit_code = main([])

    captured = capsys.readouterr()

    assert exit_code == 0
    assert "usage:" in captured.out
    assert "memory-agent" in captured.out
    assert legacy_cli not in captured.out
    assert "secrets" not in captured.out
    assert "expand" not in captured.out


def test_main_rejects_negative_list_count(capsys):
    exit_code = main(["list", "-1"])

    captured = capsys.readouterr()

    assert exit_code == 1
    assert "non-negative" in captured.err


def test_check_passes_in_empty_repo(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    exit_code = main(["check"])

    assert exit_code == 0
