module alpha (
    input  logic       clk,
    input  logic       rst_n,
    output logic [7:0] q
);
    always_ff @(posedge clk) begin
        if (!rst_n) q <= 8'h00;
        else        q <= q + 8'h01;
    end
endmodule
