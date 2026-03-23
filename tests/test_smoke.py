from notes_agent import main


def test_main_without_args_prints_help(capsys):
    exit_code = main([])

    captured = capsys.readouterr()

    assert exit_code == 0
    assert "usage:" in captured.out


def test_main_rejects_negative_list_count(capsys):
    exit_code = main(["list", "-1"])

    captured = capsys.readouterr()

    assert exit_code == 1
    assert "non-negative" in captured.err
