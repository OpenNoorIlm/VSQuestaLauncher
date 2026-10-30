module b (
    input  logic clk,
    output logic y
);
    assign y = ~clk;
endmodule
