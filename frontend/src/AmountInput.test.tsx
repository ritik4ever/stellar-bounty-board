import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AmountInput from "./AmountInput";

describe("AmountInput", () => {
  it("renders with initial value formatted with thousands separators", () => {
    render(<AmountInput value={1500} onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("1,500");
  });

  it("shows empty for zero value", () => {
    render(<AmountInput value={0} onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("");
  });

  it("renders small value without separators", () => {
    render(<AmountInput value={42} onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("42");
  });

  it("renders decimal value with separators", () => {
    render(<AmountInput value={1500.5} onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("1,500.5");
  });

  it("formats as user types large numbers", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "1200");

    expect(input).toHaveValue("1,200");
    expect(onChange).toHaveBeenLastCalledWith(1200);
  });

  it("formats progressively as user types each digit", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "10000");

    expect(input).toHaveValue("10,000");
    expect(onChange).toHaveBeenLastCalledWith(10000);
  });

  it("allows decimal input", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "2500.75");

    expect(input).toHaveValue("2,500.75");
    expect(onChange).toHaveBeenLastCalledWith(2500.75);
  });

  it("handles paste of formatted amount with currency symbol", () => {
    const onChange = vi.fn();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.paste(input, {
      clipboardData: { getData: () => "$1,500.50" },
    });

    expect(input).toHaveValue("1,500.50");
    expect(onChange).toHaveBeenLastCalledWith(1500.5);
  });

  it("handles paste of plain number", () => {
    const onChange = vi.fn();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.paste(input, {
      clipboardData: { getData: () => "5000" },
    });

    expect(input).toHaveValue("5,000");
    expect(onChange).toHaveBeenLastCalledWith(5000);
  });

  it("handles paste of text with spaces and commas", () => {
    const onChange = vi.fn();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.paste(input, {
      clipboardData: { getData: () => "10 000" },
    });

    expect(input).toHaveValue("10,000");
    expect(onChange).toHaveBeenLastCalledWith(10000);
  });

  it("handles paste of non-numeric text gracefully", () => {
    const onChange = vi.fn();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    const initialValue = input.getAttribute("value");

    fireEvent.paste(input, {
      clipboardData: { getData: () => "abc" },
    });

    // Non-numeric paste should not change the value
    expect(input.getAttribute("value")).toBe(initialValue);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears to empty when user deletes all content", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AmountInput value={5000} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.clear(input);

    expect(input).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("prevents multiple decimal points", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "1.2.3");

    // Should only keep the first decimal point
    expect(input).toHaveValue("1.23");
    expect(onChange).toHaveBeenLastCalledWith(1.23);
  });

  it("updates display when external value changes", () => {
    const { rerender } = render(<AmountInput value={100} onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("100");

    rerender(<AmountInput value={2500} onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("2,500");
  });

  it("allows placeholder to be customized", () => {
    render(<AmountInput value={0} onChange={() => {}} placeholder="Enter amount" />);
    const input = screen.getByPlaceholderText("Enter amount");
    expect(input).toBeInTheDocument();
  });

  it("uses '0' as default placeholder", () => {
    render(<AmountInput value={0} onChange={() => {}} />);
    const input = screen.getByPlaceholderText("0");
    expect(input).toBeInTheDocument();
  });
});